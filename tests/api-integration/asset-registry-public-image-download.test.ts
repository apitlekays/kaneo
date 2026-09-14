import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { getPrivateObject } from "../../apps/api/src/storage/s3";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// This route (`/api/public-asset/:id/image`) is mounted before the auth
// middleware and calls `getPrivateObject`, which makes a real network
// request to the S3 endpoint. Nothing listens on it in this environment, so
// mock it the same way tests/api-integration/meeting-action-updates.test.ts
// does for the meeting document download route.
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return { ...actual, getPrivateObject: vi.fn(actual.getPrivateObject) };
});

type App = ReturnType<typeof createApp>["app"];

function downloadPublicAssetImage(app: App, assetId: string) {
  return app.request(`/api/public-asset/${assetId}/image`);
}

async function seedAssetWithImage(
  workspaceId: string,
  createdBy: string,
  filename: string,
) {
  const [asset] = await db
    .insert(schema.registeredAssetTable)
    .values({
      workspaceId,
      serialNumber: `SN-${filename}`,
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
      mimeType: "image/png",
      size: 1024,
      kind: "image",
      createdBy,
    })
    .returning();
  if (!file) throw new Error("Failed to seed asset file");

  return { asset, file };
}

describe("API integration: public asset image download Content-Disposition", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("is safe for a hostile filename, and a non-ASCII filename round-trips through filename*", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { app } = createApp();

    // This route has no filename validation at all (unlike the meeting
    // module's presign/finalize validator), so a hostile filename could in
    // principle arrive through a real upload just as easily as through a
    // direct insert. Inserting directly is simpler and exercises exactly
    // what matters here: the download route's header-building, independent
    // of how the row got its filename.
    const hostileFilename = `evil${String.fromCharCode(34)}${String.fromCharCode(13)}${String.fromCharCode(10)}name.png`;
    const { asset: hostileAsset } = await seedAssetWithImage(
      owner.workspace.id,
      owner.user.id,
      hostileFilename,
    );

    vi.mocked(getPrivateObject).mockResolvedValueOnce({
      body: "fake-png-bytes",
      contentType: "image/png",
      contentLength: 14,
      etag: '"fake-etag"',
      lastModified: new Date(),
    });
    const hostileRes = await downloadPublicAssetImage(app, hostileAsset.id);
    expect(hostileRes.status).toBe(200);
    const hostileDisposition =
      hostileRes.headers.get("content-disposition") ?? "";
    expect(hostileDisposition).not.toMatch(/[\r\n]/);
    // Exactly the two quotes that legitimately open/close filename="..." —
    // none smuggled in from the (attacker-controlled) stored filename.
    expect((hostileDisposition.match(/"/g) ?? []).length).toBe(2);

    const nonAsciiFilename = "gambar peralatan جدول.png";
    const { asset: nonAsciiAsset } = await seedAssetWithImage(
      owner.workspace.id,
      owner.user.id,
      nonAsciiFilename,
    );

    vi.mocked(getPrivateObject).mockResolvedValueOnce({
      body: "fake-png-bytes",
      contentType: "image/png",
      contentLength: 14,
      etag: '"fake-etag"',
      lastModified: new Date(),
    });
    const nonAsciiRes = await downloadPublicAssetImage(app, nonAsciiAsset.id);
    expect(nonAsciiRes.status).toBe(200);
    const nonAsciiDisposition =
      nonAsciiRes.headers.get("content-disposition") ?? "";
    expect(nonAsciiDisposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(nonAsciiFilename)}`,
    );
  });
});
