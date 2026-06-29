import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  assetActivityTable,
  assetCostTable,
  assetCustodyTable,
  assetDisposalTable,
  assetFileTable,
  assetMaintenanceTable,
  assetReminderSentTable,
  assetRenewalTable,
  assetTripTable,
  registeredAssetTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import {
  createAssetFileUploadUrl,
  deleteS3Object,
  getPrivateObject,
  isImageContentType,
  validateTaskAssetUploadInput,
} from "../storage/s3";
import {
  hasWorkspacePageAccess,
  requireWorkspacePageAccess,
} from "../utils/page-access";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";

const PAGE_SLUG = "assets-management";
const pageAccess = requireWorkspacePageAccess(PAGE_SLUG);

const CATEGORIES = [
  "it-equipment",
  "media-equipment",
  "vehicle",
  "other",
] as const;
const STATUSES = ["active", "in-maintenance", "retired", "disposed"] as const;
const RENEWAL_TYPES = [
  "road-tax",
  "insurance",
  "inspection",
  "licence",
  "warranty",
  "other",
] as const;
const COST_CATEGORIES = [
  "purchase",
  "maintenance",
  "insurance",
  "road-tax",
  "fuel",
  "repair",
  "accessory",
  "other",
] as const;

const optStr = v.optional(v.nullable(v.string()));
const optNum = v.optional(v.nullable(v.number()));
const optDate = v.optional(v.nullable(v.string()));

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value);
}

function generateSerial() {
  return `AST-${createId().slice(0, 6).toUpperCase()}`;
}

/** Load an asset and assert it belongs to the active workspace. */
async function loadAsset(assetId: string, workspaceId: string) {
  const [asset] = await db
    .select()
    .from(registeredAssetTable)
    .where(eq(registeredAssetTable.id, assetId))
    .limit(1);
  if (!asset || asset.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Asset not found" });
  }
  return asset;
}

// Default useful life (months) by category for straight-line depreciation.
const DEFAULT_LIFE_BY_CATEGORY: Record<string, number | null> = {
  "it-equipment": 60,
  "media-equipment": 60,
  vehicle: 120,
  other: null,
};

type DepreciableAsset = {
  purchaseCost: number | null;
  depreciationMethod: string;
  usefulLifeMonths: number | null;
  salvageValue: number | null;
  inServiceDate: Date | null;
  purchaseDate: Date | null;
};

function monthsBetween(from: Date, to: Date) {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  );
}

/** Straight-line depreciation: current NBV + a per-year schedule. */
function computeDepreciation(asset: DepreciableAsset) {
  const cost = asset.purchaseCost;
  const life = asset.usefulLifeMonths;
  const salvage = asset.salvageValue ?? 0;
  const inService = asset.inServiceDate ?? asset.purchaseDate;

  if (
    asset.depreciationMethod !== "straight-line" ||
    !cost ||
    !life ||
    !inService
  ) {
    return {
      method: asset.depreciationMethod,
      usefulLifeMonths: life,
      salvageValue: salvage,
      inServiceDate: inService,
      monthlyDepreciation: 0,
      accumulatedDepreciation: 0,
      netBookValue: cost,
      schedule: [] as Array<{
        year: number;
        depreciation: number;
        openingValue: number;
        closingValue: number;
      }>,
    };
  }

  const base = Math.max(cost - salvage, 0);
  const monthly = base / life;
  const elapsed = Math.max(
    0,
    Math.min(monthsBetween(inService, new Date()), life),
  );
  const accumulated = Math.round(Math.min(elapsed * monthly, base));

  const schedule: Array<{
    year: number;
    depreciation: number;
    openingValue: number;
    closingValue: number;
  }> = [];
  let opening = cost;
  const startYear = inService.getFullYear();
  for (let y = 0; y * 12 < life; y++) {
    const monthsThisYear = Math.min(12, life - y * 12);
    const dep = Math.round(
      Math.min(monthly * monthsThisYear, Math.max(opening - salvage, 0)),
    );
    const closing = opening - dep;
    schedule.push({
      year: startYear + y,
      depreciation: dep,
      openingValue: opening,
      closingValue: closing,
    });
    opening = closing;
  }

  return {
    method: asset.depreciationMethod,
    usefulLifeMonths: life,
    salvageValue: salvage,
    inServiceDate: inService,
    monthlyDepreciation: Math.round(monthly),
    accumulatedDepreciation: accumulated,
    netBookValue: cost - accumulated,
    schedule,
  };
}

/** Append an audit-trail entry. Never throws into the request path. */
async function recordActivity(
  assetId: string,
  type: string,
  userId: string | null,
  eventData?: Record<string, unknown>,
) {
  try {
    await db.insert(assetActivityTable).values({
      assetId,
      type,
      userId,
      eventData: eventData ?? null,
    });
  } catch (error) {
    console.error("recordActivity failed", error);
  }
}

const assetRegistry = new Hono<{
  Variables: { userId: string; workspaceId?: string };
}>()
  // ── List ────────────────────────────────────────────────────────────────
  .get(
    "/",
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const assets = await db
        .select()
        .from(registeredAssetTable)
        .where(eq(registeredAssetTable.workspaceId, workspaceId))
        .orderBy(desc(registeredAssetTable.createdAt));

      // Attach each asset's soonest upcoming/overdue renewal date.
      const renewals = await db
        .select({
          assetId: assetRenewalTable.assetId,
          dueDate: assetRenewalTable.dueDate,
        })
        .from(assetRenewalTable)
        .innerJoin(
          registeredAssetTable,
          eq(assetRenewalTable.assetId, registeredAssetTable.id),
        )
        .where(eq(registeredAssetTable.workspaceId, workspaceId))
        .orderBy(asc(assetRenewalTable.dueDate));

      const nextByAsset = new Map<string, Date>();
      for (const row of renewals) {
        if (!nextByAsset.has(row.assetId)) {
          nextByAsset.set(row.assetId, row.dueDate);
        }
      }

      const custodianIds = [
        ...new Set(
          assets
            .map((a) => a.currentCustodianId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const custodians = custodianIds.length
        ? await db
            .select({
              id: userTable.id,
              name: userTable.name,
              image: userTable.image,
            })
            .from(userTable)
            .where(inArray(userTable.id, custodianIds))
        : [];
      const custodianMap = new Map(custodians.map((u) => [u.id, u]));

      return c.json(
        assets.map((asset) => ({
          ...asset,
          nextRenewalDate: nextByAsset.get(asset.id) ?? null,
          custodianName: asset.currentCustodianId
            ? (custodianMap.get(asset.currentCustodianId)?.name ?? null)
            : null,
          custodianImage: asset.currentCustodianId
            ? (custodianMap.get(asset.currentCustodianId)?.image ?? null)
            : null,
        })),
      );
    },
  )
  // ── Summary / statistics ─────────────────────────────────────────────────
  .get(
    "/summary",
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;

      const assets = await db
        .select({
          id: registeredAssetTable.id,
          category: registeredAssetTable.category,
          status: registeredAssetTable.status,
          purchaseCost: registeredAssetTable.purchaseCost,
          purchaseDate: registeredAssetTable.purchaseDate,
          depreciationMethod: registeredAssetTable.depreciationMethod,
          usefulLifeMonths: registeredAssetTable.usefulLifeMonths,
          salvageValue: registeredAssetTable.salvageValue,
          inServiceDate: registeredAssetTable.inServiceDate,
        })
        .from(registeredAssetTable)
        .where(eq(registeredAssetTable.workspaceId, workspaceId));

      const sum = (rows: { value: number | null }[]) =>
        rows.reduce((acc, r) => acc + (r.value ?? 0), 0);

      const [costRows, maintRows, tripRows] = await Promise.all([
        db
          .select({ value: assetCostTable.amount })
          .from(assetCostTable)
          .innerJoin(
            registeredAssetTable,
            eq(assetCostTable.assetId, registeredAssetTable.id),
          )
          .where(eq(registeredAssetTable.workspaceId, workspaceId)),
        db
          .select({ value: assetMaintenanceTable.cost })
          .from(assetMaintenanceTable)
          .innerJoin(
            registeredAssetTable,
            eq(assetMaintenanceTable.assetId, registeredAssetTable.id),
          )
          .where(eq(registeredAssetTable.workspaceId, workspaceId)),
        db
          .select({ value: assetTripTable.cost })
          .from(assetTripTable)
          .innerJoin(
            registeredAssetTable,
            eq(assetTripTable.assetId, registeredAssetTable.id),
          )
          .where(eq(registeredAssetTable.workspaceId, workspaceId)),
      ]);

      const costTotal = sum(costRows);
      const maintenanceTotal = sum(maintRows);
      const tripTotal = sum(tripRows);
      const purchaseTotal = assets.reduce(
        (acc, a) => acc + (a.purchaseCost ?? 0),
        0,
      );

      const byCategory: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const a of assets) {
        byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      }

      const renewals = await db
        .select({
          id: assetRenewalTable.id,
          assetId: assetRenewalTable.assetId,
          assetName: registeredAssetTable.name,
          type: assetRenewalTable.type,
          label: assetRenewalTable.label,
          dueDate: assetRenewalTable.dueDate,
        })
        .from(assetRenewalTable)
        .innerJoin(
          registeredAssetTable,
          eq(assetRenewalTable.assetId, registeredAssetTable.id),
        )
        .where(eq(registeredAssetTable.workspaceId, workspaceId))
        .orderBy(asc(assetRenewalTable.dueDate));

      const now = Date.now();
      const overdue = renewals.filter((r) => r.dueDate.getTime() < now);
      const upcoming = renewals.filter((r) => r.dueDate.getTime() >= now);

      const activeAssets = assets.filter((a) => a.status !== "disposed");
      const totalNetBookValue = activeAssets.reduce(
        (acc, a) => acc + (computeDepreciation(a).netBookValue ?? 0),
        0,
      );
      const disposedCount = assets.length - activeAssets.length;

      return c.json({
        totalAssets: assets.length,
        byCategory,
        byStatus,
        purchaseTotal,
        spendTotal: costTotal + maintenanceTotal + tripTotal,
        totalValue: purchaseTotal + costTotal + maintenanceTotal + tripTotal,
        totalNetBookValue,
        disposedCount,
        overdueRenewals: overdue,
        upcomingRenewals: upcoming.slice(0, 10),
        overdueCount: overdue.length,
        upcomingCount: upcoming.length,
      });
    },
  )
  // ── Serve a file (cookie-authed; used by <img>/download links) ───────────
  .get(
    "/file/:fileId",
    validator("param", v.object({ fileId: v.string() })),
    async (c) => {
      const { fileId } = c.req.valid("param");
      const userId = c.get("userId");
      const [file] = await db
        .select()
        .from(assetFileTable)
        .where(eq(assetFileTable.id, fileId))
        .limit(1);
      if (!file) throw new HTTPException(404, { message: "File not found" });

      await validateWorkspaceAccess(userId, file.workspaceId);
      if (
        !(await hasWorkspacePageAccess(userId, file.workspaceId, PAGE_SLUG))
      ) {
        throw new HTTPException(403, { message: "No access" });
      }

      try {
        const object = await getPrivateObject(file.objectKey);
        return new Response(object.body as BodyInit, {
          headers: {
            "Cache-Control": "private, max-age=86400",
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": object.contentType || file.mimeType,
            "Content-Disposition": `inline; filename="${file.filename}"`,
          },
        });
      } catch {
        throw new HTTPException(404, { message: "File not found" });
      }
    },
  )
  // ── Create asset ─────────────────────────────────────────────────────────
  .post(
    "/",
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        name: v.string(),
        category: v.optional(v.picklist(CATEGORIES)),
        status: v.optional(v.picklist(STATUSES)),
        assetTag: optStr,
        manufacturer: optStr,
        model: optStr,
        location: optStr,
        assignedTo: optStr,
        registrationNumber: optStr,
        purchaseDate: optDate,
        purchaseCost: optNum,
        currency: v.optional(v.string()),
        vendor: optStr,
        notes: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId");
      const body = c.req.valid("json");

      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const [asset] = await db
            .insert(registeredAssetTable)
            .values({
              workspaceId,
              serialNumber: generateSerial(),
              name: body.name,
              category: body.category ?? "other",
              status: body.status ?? "active",
              assetTag: body.assetTag ?? null,
              manufacturer: body.manufacturer ?? null,
              model: body.model ?? null,
              location: body.location ?? null,
              assignedTo: body.assignedTo ?? null,
              registrationNumber: body.registrationNumber ?? null,
              purchaseDate: toDate(body.purchaseDate),
              purchaseCost: toCents(body.purchaseCost),
              currency: body.currency || "MYR",
              usefulLifeMonths:
                DEFAULT_LIFE_BY_CATEGORY[body.category ?? "other"] ?? null,
              inServiceDate: toDate(body.purchaseDate),
              vendor: body.vendor ?? null,
              notes: body.notes ?? null,
              createdBy: userId,
            })
            .returning();
          await recordActivity(asset.id, "created", userId, {
            name: asset.name,
          });
          return c.json(asset, 201);
        } catch (error) {
          lastError = error; // serial collision → retry with a new serial
        }
      }
      throw new HTTPException(500, {
        message: `Failed to create asset: ${String(lastError)}`,
      });
    },
  )
  // ── Asset detail (asset + all sub-resources) ─────────────────────────────
  .get(
    "/:id",
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id } = c.req.valid("param");
      const asset = await loadAsset(id, workspaceId);

      const [renewals, maintenance, costs, trips, files, custody, activity] =
        await Promise.all([
          db
            .select()
            .from(assetRenewalTable)
            .where(eq(assetRenewalTable.assetId, id))
            .orderBy(asc(assetRenewalTable.dueDate)),
          db
            .select()
            .from(assetMaintenanceTable)
            .where(eq(assetMaintenanceTable.assetId, id))
            .orderBy(desc(assetMaintenanceTable.date)),
          db
            .select()
            .from(assetCostTable)
            .where(eq(assetCostTable.assetId, id))
            .orderBy(desc(assetCostTable.date)),
          db
            .select()
            .from(assetTripTable)
            .where(eq(assetTripTable.assetId, id))
            .orderBy(desc(assetTripTable.date)),
          db
            .select()
            .from(assetFileTable)
            .where(eq(assetFileTable.assetId, id))
            .orderBy(desc(assetFileTable.createdAt)),
          db
            .select({
              id: assetCustodyTable.id,
              userId: assetCustodyTable.userId,
              userName: userTable.name,
              userImage: userTable.image,
              assignedBy: assetCustodyTable.assignedBy,
              assignedAt: assetCustodyTable.assignedAt,
              releasedAt: assetCustodyTable.releasedAt,
              note: assetCustodyTable.note,
            })
            .from(assetCustodyTable)
            .leftJoin(userTable, eq(assetCustodyTable.userId, userTable.id))
            .where(eq(assetCustodyTable.assetId, id))
            .orderBy(desc(assetCustodyTable.assignedAt)),
          db
            .select({
              id: assetActivityTable.id,
              type: assetActivityTable.type,
              userId: assetActivityTable.userId,
              userName: userTable.name,
              userImage: userTable.image,
              eventData: assetActivityTable.eventData,
              createdAt: assetActivityTable.createdAt,
            })
            .from(assetActivityTable)
            .leftJoin(userTable, eq(assetActivityTable.userId, userTable.id))
            .where(eq(assetActivityTable.assetId, id))
            .orderBy(desc(assetActivityTable.createdAt))
            .limit(100),
        ]);

      const [disposal] = await db
        .select()
        .from(assetDisposalTable)
        .where(eq(assetDisposalTable.assetId, id))
        .limit(1);

      return c.json({
        asset,
        renewals,
        maintenance,
        costs,
        trips,
        files,
        custody,
        activity,
        disposal: disposal ?? null,
        depreciation: computeDepreciation(asset),
      });
    },
  )
  // ── Update asset ─────────────────────────────────────────────────────────
  .put(
    "/:id",
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    validator(
      "json",
      v.object({
        name: v.optional(v.string()),
        category: v.optional(v.picklist(CATEGORIES)),
        status: v.optional(v.picklist(STATUSES)),
        assetTag: optStr,
        manufacturer: optStr,
        model: optStr,
        location: optStr,
        assignedTo: optStr,
        registrationNumber: optStr,
        purchaseDate: optDate,
        purchaseCost: optNum,
        currency: v.optional(v.string()),
        depreciationMethod: v.optional(v.picklist(["none", "straight-line"])),
        usefulLifeMonths: optNum,
        salvageValue: optNum,
        inServiceDate: optDate,
        vendor: optStr,
        notes: optStr,
      }),
    ),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);

      const [updated] = await db
        .update(registeredAssetTable)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.assetTag !== undefined ? { assetTag: body.assetTag } : {}),
          ...(body.manufacturer !== undefined
            ? { manufacturer: body.manufacturer }
            : {}),
          ...(body.model !== undefined ? { model: body.model } : {}),
          ...(body.location !== undefined ? { location: body.location } : {}),
          ...(body.assignedTo !== undefined
            ? { assignedTo: body.assignedTo }
            : {}),
          ...(body.registrationNumber !== undefined
            ? { registrationNumber: body.registrationNumber }
            : {}),
          ...(body.purchaseDate !== undefined
            ? { purchaseDate: toDate(body.purchaseDate) }
            : {}),
          ...(body.purchaseCost !== undefined
            ? { purchaseCost: toCents(body.purchaseCost) }
            : {}),
          ...(body.currency !== undefined
            ? { currency: body.currency || "MYR" }
            : {}),
          ...(body.depreciationMethod !== undefined
            ? { depreciationMethod: body.depreciationMethod }
            : {}),
          ...(body.usefulLifeMonths !== undefined
            ? { usefulLifeMonths: body.usefulLifeMonths }
            : {}),
          ...(body.salvageValue !== undefined
            ? { salvageValue: toCents(body.salvageValue) }
            : {}),
          ...(body.inServiceDate !== undefined
            ? { inServiceDate: toDate(body.inServiceDate) }
            : {}),
          ...(body.vendor !== undefined ? { vendor: body.vendor } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(registeredAssetTable.id, id))
        .returning();

      await recordActivity(id, "updated", c.get("userId"), {
        fields: Object.keys(body),
      });
      return c.json(updated);
    },
  )
  // ── Delete asset ─────────────────────────────────────────────────────────
  .delete(
    "/:id",
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id } = c.req.valid("param");
      await loadAsset(id, workspaceId);

      // Remove S3 objects for this asset's files before the cascade delete.
      const files = await db
        .select({ objectKey: assetFileTable.objectKey })
        .from(assetFileTable)
        .where(eq(assetFileTable.assetId, id));
      await Promise.all(
        files.map((f) => deleteS3Object(f.objectKey).catch(() => {})),
      );

      await db
        .delete(registeredAssetTable)
        .where(eq(registeredAssetTable.id, id));
      return c.json({ success: true });
    },
  )
  // ── Custody (assign / transfer / release) ────────────────────────────────
  .post(
    "/:id/custody",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({ workspaceId: v.string(), userId: v.string(), note: optStr }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const actorId = c.get("userId");
      const { id } = c.req.valid("param");
      const { userId, note } = c.req.valid("json");
      await loadAsset(id, workspaceId);

      const [member] = await db
        .select({ id: workspaceUserTable.id })
        .from(workspaceUserTable)
        .where(
          and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            eq(workspaceUserTable.userId, userId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new HTTPException(404, {
          message: "User is not a member of this workspace",
        });
      }

      // Close the currently-open custody row, open a new one, denormalize.
      await db
        .update(assetCustodyTable)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(assetCustodyTable.assetId, id),
            isNull(assetCustodyTable.releasedAt),
          ),
        );
      await db.insert(assetCustodyTable).values({
        assetId: id,
        userId,
        assignedBy: actorId,
        note: note ?? null,
      });
      await db
        .update(registeredAssetTable)
        .set({ currentCustodianId: userId, updatedAt: new Date() })
        .where(eq(registeredAssetTable.id, id));
      await recordActivity(id, "custodian_changed", actorId, {
        custodianId: userId,
      });
      return c.json({ success: true });
    },
  )
  .post(
    "/:id/custody/release",
    validator("param", v.object({ id: v.string() })),
    validator("json", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const actorId = c.get("userId");
      const { id } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      await db
        .update(assetCustodyTable)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(assetCustodyTable.assetId, id),
            isNull(assetCustodyTable.releasedAt),
          ),
        );
      await db
        .update(registeredAssetTable)
        .set({ currentCustodianId: null, updatedAt: new Date() })
        .where(eq(registeredAssetTable.id, id));
      await recordActivity(id, "custodian_released", actorId);
      return c.json({ success: true });
    },
  )
  // ── Disposal / retirement ────────────────────────────────────────────────
  .post(
    "/:id/disposal",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        date: v.string(),
        method: v.optional(
          v.picklist(["sold", "scrapped", "donated", "written-off", "lost"]),
        ),
        proceeds: optNum,
        reason: optStr,
        approvedBy: optStr,
        notes: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);

      const values = {
        date: toDate(body.date) ?? new Date(),
        method: body.method ?? "sold",
        proceeds: toCents(body.proceeds),
        reason: body.reason ?? null,
        approvedBy: body.approvedBy ?? null,
        notes: body.notes ?? null,
      };
      const [row] = await db
        .insert(assetDisposalTable)
        .values({ assetId: id, createdBy: userId, ...values })
        .onConflictDoUpdate({
          target: assetDisposalTable.assetId,
          set: values,
        })
        .returning();

      await db
        .update(registeredAssetTable)
        .set({ status: "disposed", updatedAt: new Date() })
        .where(eq(registeredAssetTable.id, id));
      await recordActivity(id, "disposed", userId, { method: values.method });
      return c.json(row, 201);
    },
  )
  .delete(
    "/:id/disposal",
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const actorId = c.get("userId");
      const { id } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      await db
        .delete(assetDisposalTable)
        .where(eq(assetDisposalTable.assetId, id));
      await db
        .update(registeredAssetTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(registeredAssetTable.id, id));
      await recordActivity(id, "disposal_reverted", actorId);
      return c.json({ success: true });
    },
  )
  // ── Renewals ─────────────────────────────────────────────────────────────
  .post(
    "/:id/renewals",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        type: v.optional(v.picklist(RENEWAL_TYPES)),
        label: optStr,
        dueDate: v.string(),
        lastRenewedDate: optDate,
        cost: optNum,
        notes: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);
      const due = toDate(body.dueDate);
      if (!due) throw new HTTPException(400, { message: "Invalid due date" });

      const [row] = await db
        .insert(assetRenewalTable)
        .values({
          assetId: id,
          type: body.type ?? "other",
          label: body.label ?? null,
          dueDate: due,
          lastRenewedDate: toDate(body.lastRenewedDate),
          cost: toCents(body.cost),
          notes: body.notes ?? null,
        })
        .returning();
      return c.json(row, 201);
    },
  )
  .put(
    "/:id/renewals/:renewalId",
    validator("param", v.object({ id: v.string(), renewalId: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        type: v.optional(v.picklist(RENEWAL_TYPES)),
        label: optStr,
        dueDate: v.optional(v.string()),
        lastRenewedDate: optDate,
        cost: optNum,
        notes: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id, renewalId } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);

      const [row] = await db
        .update(assetRenewalTable)
        .set({
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: toDate(body.dueDate) ?? new Date() }
            : {}),
          ...(body.lastRenewedDate !== undefined
            ? { lastRenewedDate: toDate(body.lastRenewedDate) }
            : {}),
          ...(body.cost !== undefined ? { cost: toCents(body.cost) } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        })
        .where(
          and(
            eq(assetRenewalTable.id, renewalId),
            eq(assetRenewalTable.assetId, id),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Renewal not found" });
      // A changed due date re-arms reminders for the new cycle.
      if (body.dueDate !== undefined) {
        await db
          .delete(assetReminderSentTable)
          .where(
            and(
              eq(assetReminderSentTable.refType, "renewal"),
              eq(assetReminderSentTable.refId, renewalId),
            ),
          );
      }
      return c.json(row);
    },
  )
  .delete(
    "/:id/renewals/:renewalId",
    validator("param", v.object({ id: v.string(), renewalId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id, renewalId } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      await db
        .delete(assetRenewalTable)
        .where(
          and(
            eq(assetRenewalTable.id, renewalId),
            eq(assetRenewalTable.assetId, id),
          ),
        );
      return c.json({ success: true });
    },
  )
  // ── Maintenance ──────────────────────────────────────────────────────────
  .post(
    "/:id/maintenance",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        date: v.string(),
        title: v.string(),
        notes: optStr,
        cost: optNum,
        vendor: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);
      const [row] = await db
        .insert(assetMaintenanceTable)
        .values({
          assetId: id,
          date: toDate(body.date) ?? new Date(),
          title: body.title,
          notes: body.notes ?? null,
          cost: toCents(body.cost),
          vendor: body.vendor ?? null,
          createdBy: userId,
        })
        .returning();
      return c.json(row, 201);
    },
  )
  .delete(
    "/:id/maintenance/:entryId",
    validator("param", v.object({ id: v.string(), entryId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id, entryId } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      await db
        .delete(assetMaintenanceTable)
        .where(
          and(
            eq(assetMaintenanceTable.id, entryId),
            eq(assetMaintenanceTable.assetId, id),
          ),
        );
      return c.json({ success: true });
    },
  )
  // ── Costs ────────────────────────────────────────────────────────────────
  .post(
    "/:id/costs",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        date: v.string(),
        category: v.optional(v.picklist(COST_CATEGORIES)),
        amount: v.number(),
        note: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);
      const [row] = await db
        .insert(assetCostTable)
        .values({
          assetId: id,
          date: toDate(body.date) ?? new Date(),
          category: body.category ?? "other",
          amount: Math.round(body.amount),
          note: body.note ?? null,
          createdBy: userId,
        })
        .returning();
      return c.json(row, 201);
    },
  )
  .delete(
    "/:id/costs/:entryId",
    validator("param", v.object({ id: v.string(), entryId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id, entryId } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      await db
        .delete(assetCostTable)
        .where(
          and(eq(assetCostTable.id, entryId), eq(assetCostTable.assetId, id)),
        );
      return c.json({ success: true });
    },
  )
  // ── Trips ────────────────────────────────────────────────────────────────
  .post(
    "/:id/trips",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        date: v.string(),
        origin: optStr,
        destination: optStr,
        distanceKm: optNum,
        purpose: optStr,
        driver: optStr,
        cost: optNum,
        notes: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);
      const [row] = await db
        .insert(assetTripTable)
        .values({
          assetId: id,
          date: toDate(body.date) ?? new Date(),
          origin: body.origin ?? null,
          destination: body.destination ?? null,
          distanceKm:
            body.distanceKm != null ? Math.round(body.distanceKm) : null,
          purpose: body.purpose ?? null,
          driver: body.driver ?? null,
          cost: toCents(body.cost),
          notes: body.notes ?? null,
          createdBy: userId,
        })
        .returning();
      return c.json(row, 201);
    },
  )
  .delete(
    "/:id/trips/:entryId",
    validator("param", v.object({ id: v.string(), entryId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id, entryId } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      await db
        .delete(assetTripTable)
        .where(
          and(eq(assetTripTable.id, entryId), eq(assetTripTable.assetId, id)),
        );
      return c.json({ success: true });
    },
  )
  // ── Files: presign → finalize → delete ───────────────────────────────────
  .put(
    "/:id/files/upload",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        kind: v.optional(v.picklist(["image", "document"])),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id } = c.req.valid("param");
      const { filename, contentType, size, kind } = c.req.valid("json");
      await loadAsset(id, workspaceId);

      try {
        validateTaskAssetUploadInput(contentType, size);
      } catch (error) {
        throw new HTTPException(400, {
          message: error instanceof Error ? error.message : "Invalid upload",
        });
      }

      const resolvedKind =
        kind ?? (isImageContentType(contentType) ? "image" : "document");

      const upload = await createAssetFileUploadUrl({
        workspaceId,
        assetId: id,
        kind: resolvedKind,
        filename,
        contentType,
      });
      return c.json({ ...upload, kind: resolvedKind });
    },
  )
  .post(
    "/:id/files/finalize",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        objectKey: v.string(),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        kind: v.picklist(["image", "document"]),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);

      const [row] = await db
        .insert(assetFileTable)
        .values({
          assetId: id,
          workspaceId,
          objectKey: body.objectKey,
          filename: body.filename,
          mimeType: body.contentType,
          size: Math.round(body.size),
          kind: body.kind,
          createdBy: userId,
        })
        .returning();
      return c.json(row, 201);
    },
  )
  .delete(
    "/:id/files/:fileId",
    validator("param", v.object({ id: v.string(), fileId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const { id, fileId } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      const [file] = await db
        .select()
        .from(assetFileTable)
        .where(
          and(eq(assetFileTable.id, fileId), eq(assetFileTable.assetId, id)),
        )
        .limit(1);
      if (file) {
        await deleteS3Object(file.objectKey).catch(() => {});
        await db.delete(assetFileTable).where(eq(assetFileTable.id, fileId));
      }
      return c.json({ success: true });
    },
  );

export default assetRegistry;
