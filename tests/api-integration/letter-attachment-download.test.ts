import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { getPrivateObject } from "../../apps/api/src/storage/s3";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Same reasoning as meeting-action-updates.test.ts: the download route calls
// `getPrivateObject`, which makes a real network request against an S3
// endpoint nothing listens on in this environment.
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return { ...actual, getPrivateObject: vi.fn(actual.getPrivateObject) };
});

type App = ReturnType<typeof createApp>["app"];

function captureLetter(app: App, workspaceId: string, subject: string) {
  return app.request("/api/correspondence/letters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject,
    }),
  });
}

function downloadAttachment(
  app: App,
  letterId: string,
  attachmentId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/correspondence/letters/${letterId}/attachments/${attachmentId}/download?workspaceId=${workspaceId}`,
  );
}

async function seedAttachment(
  letterId: string,
  workspaceId: string,
  createdBy: string,
  filename: string,
) {
  const [attachment] = await db
    .insert(schema.letterAttachmentTable)
    .values({
      letterId,
      workspaceId,
      objectKey: `workspace/${workspaceId}/letter/${letterId}/${randomUUID()}`,
      filename,
      mimeType: "application/pdf",
      size: 1024,
      createdBy,
    })
    .returning();
  if (!attachment) throw new Error("Failed to seed letter attachment");
  return attachment;
}

describe("API integration: letter attachment download Content-Disposition", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("is safe for a hostile filename, and a non-ASCII filename round-trips through filename*", async () => {
    // Owner bypasses the general-management page-access gate
    // (GLOBAL_ADMIN_ROLES), so this exercises the download route's
    // header-building directly.
    const officer = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();

    const captured = await captureLetter(
      app,
      officer.workspace.id,
      "Test Letter",
    );
    expect(captured.status).toBe(201);
    const letter = await captured.json();

    // The attach route's filename field is an unrestricted `v.string()` —
    // unlike the meeting module's stricter presign/finalize validator — so a
    // hostile filename could arrive through the real attach endpoint just
    // as easily as through a direct insert. Inserting directly is simpler
    // and keeps the test focused on the download route's header-building
    // rather than the attach flow's objectKey plumbing.
    const hostileFilename = `evil${String.fromCharCode(34)}${String.fromCharCode(13)}${String.fromCharCode(10)}name.pdf`;
    const hostileAttachment = await seedAttachment(
      letter.id,
      officer.workspace.id,
      officer.user.id,
      hostileFilename,
    );

    vi.mocked(getPrivateObject).mockResolvedValueOnce({
      body: "fake-pdf-bytes",
      contentType: "application/pdf",
      contentLength: 14,
      etag: '"fake-etag"',
      lastModified: new Date(),
    });
    const hostileRes = await downloadAttachment(
      app,
      letter.id,
      hostileAttachment.id,
      officer.workspace.id,
    );
    expect(hostileRes.status).toBe(200);
    const hostileDisposition =
      hostileRes.headers.get("content-disposition") ?? "";
    expect(hostileDisposition).not.toMatch(/[\r\n]/);
    expect((hostileDisposition.match(/"/g) ?? []).length).toBe(2);

    const nonAsciiFilename = "surat rasmi جدول.pdf";
    const nonAsciiAttachment = await seedAttachment(
      letter.id,
      officer.workspace.id,
      officer.user.id,
      nonAsciiFilename,
    );

    vi.mocked(getPrivateObject).mockResolvedValueOnce({
      body: "fake-pdf-bytes",
      contentType: "application/pdf",
      contentLength: 14,
      etag: '"fake-etag"',
      lastModified: new Date(),
    });
    const nonAsciiRes = await downloadAttachment(
      app,
      letter.id,
      nonAsciiAttachment.id,
      officer.workspace.id,
    );
    expect(nonAsciiRes.status).toBe(200);
    const nonAsciiDisposition =
      nonAsciiRes.headers.get("content-disposition") ?? "";
    expect(nonAsciiDisposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(nonAsciiFilename)}`,
    );
  });
});
