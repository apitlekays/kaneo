import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  assetReminderSentTable,
  assetRentalTable,
  userTable,
} from "../database/schema";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { loadAsset, recordActivity } from "./index";

const pageAccess = requireWorkspacePageAccess("assets-management");

const RATE_PERIODS = ["day", "week", "month", "fixed"] as const;

const optStr = v.optional(v.nullable(v.string()));
// Money in minor units (sen), as every other asset amount.
const optCents = v.optional(v.nullable(v.pipe(v.number(), v.integer())));

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredDate(value: string, field: string): Date {
  const date = toDate(value);
  if (!date) throw new HTTPException(400, { message: `Invalid ${field}` });
  return date;
}

/**
 * Dates come from a day picker (local midnight) while a start time can
 * carry the hour, so "the same day" must not read as "before". A day of
 * slack covers every time zone without rejecting a same-day return.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
function isBeforeDay(date: Date, reference: Date) {
  return date.getTime() < reference.getTime() - DAY_MS;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const renterFields = {
  renterName: v.pipe(v.string(), v.trim(), v.minLength(1)),
  renterOrganisation: optStr,
  renterPhone: optStr,
  renterEmail: optStr,
  renterIdNumber: optStr,
  purpose: optStr,
  dueAt: optStr,
  rate: optCents,
  ratePeriod: v.optional(v.nullable(v.picklist(RATE_PERIODS))),
  deposit: optCents,
  currency: optStr,
  conditionOut: optStr,
  notes: optStr,
};

async function loadRental(rentalId: string, assetId: string) {
  const [rental] = await db
    .select()
    .from(assetRentalTable)
    .where(
      and(
        eq(assetRentalTable.id, rentalId),
        eq(assetRentalTable.assetId, assetId),
      ),
    )
    .limit(1);
  if (!rental) throw new HTTPException(404, { message: "Rental not found" });
  return rental;
}

/**
 * Rentals: an asset going out to someone outside the organisation and
 * coming back. Mounted beside the main asset-registry router under the
 * same /asset-registry prefix and page-access gate.
 */
const assetRentals = new Hono<{
  Variables: { userId: string; workspaceId: string };
}>()
  .get(
    "/:id/rentals",
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const { id } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      const rows = await db
        .select({
          rental: assetRentalTable,
          createdByName: userTable.name,
        })
        .from(assetRentalTable)
        .leftJoin(userTable, eq(assetRentalTable.createdBy, userTable.id))
        .where(eq(assetRentalTable.assetId, id))
        .orderBy(desc(assetRentalTable.startAt));
      return c.json(
        rows.map((r) => ({ ...r.rental, createdByName: r.createdByName })),
      );
    },
  )
  .post(
    "/:id/rentals",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        startAt: v.string(),
        ...renterFields,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const asset = await loadAsset(id, workspaceId);

      if (asset.status === "disposed" || asset.status === "retired") {
        throw new HTTPException(400, {
          message: `A ${asset.status} asset cannot be rented out`,
        });
      }
      if (
        asset.status === "pending-disposal" ||
        asset.status === "approved-for-disposal"
      ) {
        throw new HTTPException(400, {
          message: "An asset going through disposal cannot be rented out",
        });
      }

      const startAt = requiredDate(body.startAt, "start date");
      const dueAt = toDate(body.dueAt);
      if (dueAt && isBeforeDay(dueAt, startAt)) {
        throw new HTTPException(400, {
          message: "The return date cannot be before the start date",
        });
      }

      const [open] = await db
        .select({ id: assetRentalTable.id })
        .from(assetRentalTable)
        .where(
          and(
            eq(assetRentalTable.assetId, id),
            isNull(assetRentalTable.returnedAt),
          ),
        )
        .limit(1);
      if (open) {
        throw new HTTPException(409, {
          message: "This asset is already out on rent — mark it returned first",
        });
      }

      const [rental] = await db
        .insert(assetRentalTable)
        .values({
          assetId: id,
          workspaceId,
          renterName: body.renterName,
          renterOrganisation: clean(body.renterOrganisation),
          renterPhone: clean(body.renterPhone),
          renterEmail: clean(body.renterEmail),
          renterIdNumber: clean(body.renterIdNumber),
          purpose: clean(body.purpose),
          startAt,
          dueAt,
          rate: body.rate ?? null,
          ratePeriod: body.rate != null ? (body.ratePeriod ?? "day") : null,
          deposit: body.deposit ?? null,
          currency: clean(body.currency) ?? asset.currency,
          conditionOut: clean(body.conditionOut),
          notes: clean(body.notes),
          createdBy: userId,
        })
        .returning();

      await recordActivity(id, "rental_started", userId, {
        rentalId: rental?.id,
        renterName: body.renterName,
        dueAt: dueAt?.toISOString() ?? null,
      });
      return c.json(rental, 201);
    },
  )
  .put(
    "/:id/rentals/:rentalId",
    validator("param", v.object({ id: v.string(), rentalId: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        startAt: v.optional(v.string()),
        ...renterFields,
        renterName: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
        conditionIn: optStr,
        depositReturned: v.optional(v.boolean()),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const { id, rentalId } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);
      const rental = await loadRental(rentalId, id);

      const startAt =
        body.startAt !== undefined
          ? requiredDate(body.startAt, "start date")
          : rental.startAt;
      const dueAt =
        body.dueAt !== undefined ? toDate(body.dueAt) : rental.dueAt;
      if (dueAt && isBeforeDay(dueAt, startAt)) {
        throw new HTTPException(400, {
          message: "The return date cannot be before the start date",
        });
      }

      const set = <K extends string>(key: K, value: unknown) =>
        value !== undefined ? { [key]: value } : {};
      const [updated] = await db
        .update(assetRentalTable)
        .set({
          startAt,
          dueAt,
          ...set("renterName", body.renterName),
          ...set("renterOrganisation", body.renterOrganisation),
          ...set("renterPhone", body.renterPhone),
          ...set("renterEmail", body.renterEmail),
          ...set("renterIdNumber", body.renterIdNumber),
          ...set("purpose", body.purpose),
          ...set("rate", body.rate),
          ...set("ratePeriod", body.ratePeriod),
          ...set("deposit", body.deposit),
          ...set("currency", body.currency),
          ...set("conditionOut", body.conditionOut),
          ...set("conditionIn", body.conditionIn),
          ...set("depositReturned", body.depositReturned),
          ...set("notes", body.notes),
        })
        .where(eq(assetRentalTable.id, rentalId))
        .returning();

      // A new return date re-arms the overdue reminder.
      if (dueAt?.getTime() !== rental.dueAt?.getTime()) {
        await db
          .delete(assetReminderSentTable)
          .where(
            and(
              eq(assetReminderSentTable.refType, "rental"),
              eq(assetReminderSentTable.refId, rentalId),
            ),
          );
      }
      return c.json(updated);
    },
  )
  .post(
    "/:id/rentals/:rentalId/return",
    validator("param", v.object({ id: v.string(), rentalId: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        returnedAt: optStr,
        conditionIn: optStr,
        depositReturned: v.optional(v.boolean()),
        notes: optStr,
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      const { id, rentalId } = c.req.valid("param");
      const body = c.req.valid("json");
      await loadAsset(id, workspaceId);
      const rental = await loadRental(rentalId, id);
      if (rental.returnedAt) {
        throw new HTTPException(409, {
          message: "This rental was already marked returned",
        });
      }

      const returnedAt = toDate(body.returnedAt) ?? new Date();
      if (isBeforeDay(returnedAt, rental.startAt)) {
        throw new HTTPException(400, {
          message: "The return date cannot be before the start date",
        });
      }

      const [updated] = await db
        .update(assetRentalTable)
        .set({
          returnedAt,
          returnedBy: userId,
          conditionIn: clean(body.conditionIn),
          depositReturned: body.depositReturned ?? rental.depositReturned,
          notes: body.notes !== undefined ? clean(body.notes) : rental.notes,
        })
        .where(
          and(
            eq(assetRentalTable.id, rentalId),
            isNull(assetRentalTable.returnedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw new HTTPException(409, {
          message: "This rental was already marked returned",
        });
      }

      await recordActivity(id, "rental_returned", userId, {
        rentalId,
        renterName: rental.renterName,
        late: rental.dueAt ? returnedAt > rental.dueAt : false,
      });
      return c.json(updated);
    },
  )
  .delete(
    "/:id/rentals/:rentalId",
    validator("param", v.object({ id: v.string(), rentalId: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      const { id, rentalId } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      const rental = await loadRental(rentalId, id);
      await db
        .delete(assetRentalTable)
        .where(eq(assetRentalTable.id, rentalId));
      await recordActivity(id, "rental_deleted", userId, {
        rentalId,
        renterName: rental.renterName,
      });
      return c.json({ success: true });
    },
  );

export default assetRentals;
