import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { getPrivateObject } from "../../apps/api/src/storage/s3";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Same reasoning as meeting-action-updates.test.ts and
// asset-registry-public-image-download.test.ts: the download route calls
// `getPrivateObject`, which makes a real network request against an S3
// endpoint nothing listens on in this environment.
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return { ...actual, getPrivateObject: vi.fn(actual.getPrivateObject) };
});

type App = ReturnType<typeof createApp>["app"];

function downloadFile(app: App, fileId: string) {
  return app.request(`/api/asset-registry/file/${fileId}`);
}

async function seedAssetFile(
  workspaceId: string,
  createdBy: string,
  filename: string,
) {
  const [asset] = await db
    .insert(schema.registeredAssetTable)
    .values({
      workspaceId,
      serialNumber: `SN-${randomUUID()}`,
      name: "Test Asset",
    })
    .returning();
  if (!asset) throw new Error("Failed to seed asset");

  const [file] = await db
    .insert(schema.assetFileTable)
    .values({
      assetId: asset.id,
      workspaceId,
      objectKey: `workspace/${workspaceId}/asset/${asset.id}/${randomUUID()}`,
      filename,
      mimeType: "application/pdf",
      size: 1024,
      kind: "document",
      createdBy,
    })
    .returning();
  if (!file) throw new Error("Failed to seed asset file");

  return file;
}

describe("API integration: asset-registry file download Content-Disposition", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("is safe for a hostile filename, and a non-ASCII filename round-trips through filename*", async () => {
    // Owner bypasses the assets-management page-access gate (GLOBAL_ADMIN_ROLES),
    // so this exercises the download route's header-building without needing
    // a separate workspace_page_access grant.
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    // The asset-file upload path accepts any filename string here too — the
    // stricter validator only exists on the newer meeting module — so a
    // direct insert is just a simpler way to get a row with a hostile
    // filename, not a shortcut around any protection this route relies on.
    const hostileFilename = `evil${String.fromCharCode(34)}${String.fromCharCode(13)}${String.fromCharCode(10)}name.pdf`;
    const hostileFile = await seedAssetFile(
      owner.workspace.id,
      owner.user.id,
      hostileFilename,
    );

    vi.mocked(getPrivateObject).mockResolvedValueOnce({
      body: "fake-pdf-bytes",
      contentType: "application/pdf",
      contentLength: 14,
      etag: '"fake-etag"',
      lastModified: new Date(),
    });
    const hostileRes = await downloadFile(app, hostileFile.id);
    expect(hostileRes.status).toBe(200);
    const hostileDisposition =
      hostileRes.headers.get("content-disposition") ?? "";
    expect(hostileDisposition).not.toMatch(/[\r\n]/);
    expect((hostileDisposition.match(/"/g) ?? []).length).toBe(2);

    const nonAsciiFilename = "laporan penyelenggaraan جدول.pdf";
    const nonAsciiFile = await seedAssetFile(
      owner.workspace.id,
      owner.user.id,
      nonAsciiFilename,
    );

    vi.mocked(getPrivateObject).mockResolvedValueOnce({
      body: "fake-pdf-bytes",
      contentType: "application/pdf",
      contentLength: 14,
      etag: '"fake-etag"',
      lastModified: new Date(),
    });
    const nonAsciiRes = await downloadFile(app, nonAsciiFile.id);
    expect(nonAsciiRes.status).toBe(200);
    const nonAsciiDisposition =
      nonAsciiRes.headers.get("content-disposition") ?? "";
    expect(nonAsciiDisposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(nonAsciiFilename)}`,
    );
  });
});
