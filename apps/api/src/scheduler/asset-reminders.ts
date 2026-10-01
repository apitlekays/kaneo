import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
} from "drizzle-orm";
import db from "../database";
import {
  assetMeterReadingTable,
  assetPmScheduleTable,
  assetReminderSentTable,
  assetRenewalTable,
  assetRentalTable,
  driverProfileTable,
  registeredAssetTable,
  workOrderTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole calendar days until `due` (negative = overdue). */
function daysUntil(due: Date, today: Date) {
  return Math.round(
    (startOfDay(due).getTime() - startOfDay(today).getTime()) / DAY_MS,
  );
}

/** Most-urgent applicable reminder window, or null if too far out. */
function windowFor(days: number): string | null {
  if (days < 0) return "overdue";
  if (days <= 1) return "1d";
  if (days <= 7) return "7d";
  if (days <= 30) return "30d";
  return null;
}

const RENEWAL_LABELS: Record<string, string> = {
  "road-tax": "Road Tax",
  insurance: "Insurance",
  inspection: "Inspection",
  licence: "Licence",
  warranty: "Warranty",
  other: "Renewal",
};

function phraseFor(window: string): string {
  switch (window) {
    case "overdue":
      return "is overdue";
    case "1d":
      return "is due tomorrow";
    case "7d":
      return "is due in 7 days";
    default:
      return "is due in 30 days";
  }
}

/**
 * Daily scan of asset renewals. For each renewal entering a reminder window
 * (30/7/1 days before, or overdue) that hasn't been notified for that window,
 * notify the asset's current custodian (falling back to its creator). Dedup via
 * asset_reminder_sent so each window fires once; the window keys re-arm when a
 * renewal's due date changes (cleared in the renewal update route).
 */
export async function checkAssetRemindersDue(): Promise<void> {
  const today = new Date();

  let rows: Array<{
    renewalId: string;
    type: string;
    label: string | null;
    dueDate: Date;
    assetId: string;
    assetName: string;
    serial: string;
    custodianId: string | null;
    createdBy: string | null;
  }>;
  try {
    rows = await db
      .select({
        renewalId: assetRenewalTable.id,
        type: assetRenewalTable.type,
        label: assetRenewalTable.label,
        dueDate: assetRenewalTable.dueDate,
        assetId: registeredAssetTable.id,
        assetName: registeredAssetTable.name,
        serial: registeredAssetTable.serialNumber,
        custodianId: registeredAssetTable.currentCustodianId,
        createdBy: registeredAssetTable.createdBy,
      })
      .from(assetRenewalTable)
      .innerJoin(
        registeredAssetTable,
        eq(assetRenewalTable.assetId, registeredAssetTable.id),
      )
      .where(isNotNull(assetRenewalTable.dueDate));
  } catch (error) {
    console.error("Failed to query asset renewals for reminders", error);
    return;
  }

  for (const row of rows) {
    const recipient = row.custodianId ?? row.createdBy;
    if (!recipient) continue;

    const window = windowFor(daysUntil(row.dueDate, today));
    if (!window) continue;

    try {
      const [inserted] = await db
        .insert(assetReminderSentTable)
        .values({
          refType: "renewal",
          refId: row.renewalId,
          reminderWindow: window,
        })
        .onConflictDoNothing({
          target: [
            assetReminderSentTable.refType,
            assetReminderSentTable.refId,
            assetReminderSentTable.reminderWindow,
          ],
        })
        .returning();
      if (!inserted) continue;
    } catch {
      continue;
    }

    const label = row.label || RENEWAL_LABELS[row.type] || "Renewal";
    const dueStr = row.dueDate.toISOString().slice(0, 10);

    try {
      await createNotification({
        userId: recipient,
        type: "asset_renewal_reminder",
        title: `${label} ${phraseFor(window)} — ${row.assetName}`,
        content: `${row.assetName} (${row.serial}): ${label} due ${dueStr}.`,
        eventData: {
          assetId: row.assetId,
          assetName: row.assetName,
          serial: row.serial,
          renewalType: row.type,
          renewalLabel: label,
          dueDate: row.dueDate.toISOString(),
          window,
        },
        resourceId: row.assetId,
        resourceType: "asset",
      });
    } catch (error) {
      console.error("Failed to send asset renewal reminder", {
        renewalId: row.renewalId,
        error,
      });
    }
  }

  await raisePreventiveMaintenanceWorkOrders();
  await checkDriverLicenceReminders();
  await checkOverdueRentals();
}

/**
 * Once a rented-out asset passes its return date without being marked
 * returned, tell whoever recorded the rental (falling back to the asset's
 * custodian). Fires once per rental; changing the return date re-arms it
 * (see asset-registry/rentals.ts).
 */
async function checkOverdueRentals(): Promise<void> {
  const now = new Date();
  let rentals: Array<{
    rentalId: string;
    assetId: string;
    assetName: string;
    renterName: string;
    dueAt: Date | null;
    createdBy: string | null;
    custodianId: string | null;
  }>;
  try {
    rentals = await db
      .select({
        rentalId: assetRentalTable.id,
        assetId: assetRentalTable.assetId,
        assetName: registeredAssetTable.name,
        renterName: assetRentalTable.renterName,
        dueAt: assetRentalTable.dueAt,
        createdBy: assetRentalTable.createdBy,
        custodianId: registeredAssetTable.currentCustodianId,
      })
      .from(assetRentalTable)
      .innerJoin(
        registeredAssetTable,
        eq(assetRentalTable.assetId, registeredAssetTable.id),
      )
      .where(
        and(
          isNull(assetRentalTable.returnedAt),
          lt(assetRentalTable.dueAt, now),
        ),
      );
  } catch (error) {
    console.error("Failed to query overdue rentals", error);
    return;
  }

  for (const r of rentals) {
    const recipient = r.createdBy ?? r.custodianId;
    if (!recipient || !r.dueAt) continue;

    try {
      const [inserted] = await db
        .insert(assetReminderSentTable)
        .values({
          refType: "rental",
          refId: r.rentalId,
          reminderWindow: "overdue",
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) continue;
    } catch {
      continue;
    }

    const dueStr = r.dueAt.toISOString().slice(0, 10);
    try {
      await createNotification({
        userId: recipient,
        type: "asset_rental_overdue",
        title: `Rental overdue — ${r.assetName}`,
        content: `${r.assetName} was due back from ${r.renterName} on ${dueStr} and has not been marked returned.`,
        resourceId: r.assetId,
        resourceType: "asset",
      });
    } catch (error) {
      console.error("Failed to send rental overdue reminder", {
        rentalId: r.rentalId,
        error,
      });
    }
  }
}

/**
 * Raise a "scheduled" work order for each active PM schedule that is due —
 * time-based (nextDueDate passed) or meter-based (latest reading ≥ nextDueMeter)
 * — and that has no open work order. The open-work-order check is the dedup.
 */
async function raisePreventiveMaintenanceWorkOrders(): Promise<void> {
  const now = new Date();
  let schedules: Array<{
    scheduleId: string;
    title: string;
    nextDueDate: Date | null;
    nextDueMeter: number | null;
    assetId: string;
    assetName: string;
    workspaceId: string;
    custodianId: string | null;
    createdBy: string | null;
  }>;
  try {
    schedules = await db
      .select({
        scheduleId: assetPmScheduleTable.id,
        title: assetPmScheduleTable.title,
        nextDueDate: assetPmScheduleTable.nextDueDate,
        nextDueMeter: assetPmScheduleTable.nextDueMeter,
        assetId: registeredAssetTable.id,
        assetName: registeredAssetTable.name,
        workspaceId: registeredAssetTable.workspaceId,
        custodianId: registeredAssetTable.currentCustodianId,
        createdBy: registeredAssetTable.createdBy,
      })
      .from(assetPmScheduleTable)
      .innerJoin(
        registeredAssetTable,
        eq(assetPmScheduleTable.assetId, registeredAssetTable.id),
      )
      .where(eq(assetPmScheduleTable.active, true));
  } catch (error) {
    console.error("Failed to query PM schedules", error);
    return;
  }

  // Latest meter value per asset, for meter-based schedules.
  const meterAssetIds = [
    ...new Set(
      schedules.filter((s) => s.nextDueMeter != null).map((s) => s.assetId),
    ),
  ];
  const meterMax = new Map<string, number>();
  if (meterAssetIds.length) {
    const readings = await db
      .select({
        assetId: assetMeterReadingTable.assetId,
        value: assetMeterReadingTable.value,
      })
      .from(assetMeterReadingTable)
      .where(inArray(assetMeterReadingTable.assetId, meterAssetIds));
    for (const r of readings) {
      if (r.value > (meterMax.get(r.assetId) ?? Number.NEGATIVE_INFINITY)) {
        meterMax.set(r.assetId, r.value);
      }
    }
  }

  for (const s of schedules) {
    const due =
      s.nextDueMeter != null
        ? (meterMax.get(s.assetId) ?? Number.NEGATIVE_INFINITY) >=
          s.nextDueMeter
        : s.nextDueDate != null && s.nextDueDate.getTime() <= now.getTime();
    if (!due) continue;

    try {
      const open = await db
        .select({ id: workOrderTable.id })
        .from(workOrderTable)
        .where(
          and(
            eq(workOrderTable.pmScheduleId, s.scheduleId),
            notInArray(workOrderTable.status, ["done", "cancelled"]),
          ),
        )
        .limit(1);
      if (open.length) continue;

      await db.insert(workOrderTable).values({
        workspaceId: s.workspaceId,
        assetId: s.assetId,
        pmScheduleId: s.scheduleId,
        title: `PM due: ${s.title}`,
        status: "scheduled",
        priority: "medium",
        assigneeId: s.custodianId ?? null,
        dueDate: s.nextDueDate ?? null,
      });

      const recipient = s.custodianId ?? s.createdBy;
      if (recipient) {
        await createNotification({
          userId: recipient,
          type: "asset_maintenance_due",
          title: `Maintenance due — ${s.assetName}`,
          content: `${s.assetName}: ${s.title} is due.`,
          resourceId: s.assetId,
          resourceType: "asset",
        });
      }
    } catch (error) {
      console.error("Failed to raise PM work order", {
        scheduleId: s.scheduleId,
        error,
      });
    }
  }
}

/**
 * Notify drivers whose licence is entering an expiry window (30/7/1 days /
 * overdue). Deduped per (profile, window) via asset_reminder_sent.
 */
async function checkDriverLicenceReminders(): Promise<void> {
  const today = new Date();
  let drivers: Array<{
    profileId: string;
    userId: string;
    licenceExpiry: Date | null;
  }>;
  try {
    drivers = await db
      .select({
        profileId: driverProfileTable.id,
        userId: driverProfileTable.userId,
        licenceExpiry: driverProfileTable.licenceExpiry,
      })
      .from(driverProfileTable)
      .where(isNotNull(driverProfileTable.licenceExpiry));
  } catch (error) {
    console.error("Failed to query driver licences", error);
    return;
  }

  for (const d of drivers) {
    if (!d.licenceExpiry) continue;
    const window = windowFor(daysUntil(d.licenceExpiry, today));
    if (!window) continue;

    try {
      const [inserted] = await db
        .insert(assetReminderSentTable)
        .values({
          refType: "driver-licence",
          refId: d.profileId,
          reminderWindow: window,
        })
        .onConflictDoNothing({
          target: [
            assetReminderSentTable.refType,
            assetReminderSentTable.refId,
            assetReminderSentTable.reminderWindow,
          ],
        })
        .returning();
      if (!inserted) continue;
    } catch {
      continue;
    }

    const dueStr = d.licenceExpiry.toISOString().slice(0, 10);
    try {
      await createNotification({
        userId: d.userId,
        type: "asset_renewal_reminder",
        title: `Driving licence ${phraseFor(window)}`,
        content: `Your driving licence expires ${dueStr}.`,
        // Without an id, delivery cannot tell which workspace this belongs
        // to, so it never reached email or any other channel.
        resourceId: d.profileId,
        resourceType: "driver",
      });
    } catch (error) {
      console.error("Failed to send driver licence reminder", {
        profileId: d.profileId,
        error,
      });
    }
  }
}
