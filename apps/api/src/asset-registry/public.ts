import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  assetFileTable,
  assetLocationTable,
  registeredAssetTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { getPrivateObject } from "../storage/s3";

/**
 * Resolve a location's full "Site / Building / Room" path within a workspace.
 * Bounded to avoid an accidental cycle in the self-referential parent chain.
 */
async function resolveLocationPath(
  locationId: string | null,
  workspaceId: string,
) {
  if (!locationId) return null;
  const segments: string[] = [];
  let currentId: string | null = locationId;
  for (let depth = 0; currentId && depth < 12; depth++) {
    const [loc]: { name: string; parentId: string | null }[] = await db
      .select({
        name: assetLocationTable.name,
        parentId: assetLocationTable.parentId,
      })
      .from(assetLocationTable)
      .where(
        and(
          eq(assetLocationTable.id, currentId),
          eq(assetLocationTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!loc) break;
    segments.unshift(loc.name);
    currentId = loc.parentId;
  }
  return segments.length ? segments.join(" / ") : null;
}

async function loadPublicAsset(id: string) {
  const [asset] = await db
    .select()
    .from(registeredAssetTable)
    .where(eq(registeredAssetTable.id, id))
    .limit(1);
  if (!asset) throw new HTTPException(404, { message: "Asset not found" });
  return asset;
}

async function firstImageFile(assetId: string) {
  const [file] = await db
    .select()
    .from(assetFileTable)
    .where(
      and(
        eq(assetFileTable.assetId, assetId),
        eq(assetFileTable.kind, "image"),
      ),
    )
    .orderBy(asc(assetFileTable.createdAt))
    .limit(1);
  return file ?? null;
}

/**
 * Unauthenticated, read-only view of an asset for the QR-code public page. The
 * asset id is an unguessable cuid, so the URL acts as a capability token. Only
 * non-sensitive fields are exposed — no cost/financials, vendor, notes, custom
 * fields, or history. Mounted BEFORE the API auth middleware.
 */
const publicAsset = new Hono()
  .get("/:id", validator("param", v.object({ id: v.string() })), async (c) => {
    const { id } = c.req.valid("param");
    const asset = await loadPublicAsset(id);

    const [custodian] = asset.currentCustodianId
      ? await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, asset.currentCustodianId))
          .limit(1)
      : [];

    const [org] = await db
      .select({ name: workspaceTable.name })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, asset.workspaceId))
      .limit(1);

    const locationName =
      (await resolveLocationPath(asset.locationId, asset.workspaceId)) ??
      asset.location;

    const image = await firstImageFile(asset.id);

    return c.json({
      id: asset.id,
      name: asset.name,
      serialNumber: asset.serialNumber,
      assetTag: asset.assetTag,
      category: asset.category,
      status: asset.status,
      manufacturer: asset.manufacturer,
      model: asset.model,
      registrationNumber: asset.registrationNumber,
      locationName,
      custodianName: custodian?.name ?? null,
      organizationName: org?.name ?? null,
      hasImage: Boolean(image),
    });
  })
  .get(
    "/:id/image",
    validator("param", v.object({ id: v.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const asset = await loadPublicAsset(id);
      const image = await firstImageFile(asset.id);
      if (!image) throw new HTTPException(404, { message: "No image" });

      try {
        const object = await getPrivateObject(image.objectKey);
        return new Response(object.body as BodyInit, {
          headers: {
            "Cache-Control": "public, max-age=300",
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": object.contentType || image.mimeType,
            "Content-Disposition": `inline; filename="${image.filename}"`,
          },
        });
      } catch {
        throw new HTTPException(404, { message: "Image not found" });
      }
    },
  );

export default publicAsset;
