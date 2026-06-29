import { and, eq, isNotNull, lte, notInArray } from "drizzle-orm";
import db from "../database";
import {
  assetPmScheduleTable,
  assetReminderSentTable,
  assetRenewalTable,
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
}

/**
 * For each active PM schedule whose nextDueDate has arrived and that has no open
 * work order yet, raise a "scheduled" work order assigned to the custodian and
 * notify them. The open-work-order check is the dedup.
 */
async function raisePreventiveMaintenanceWorkOrders(): Promise<void> {
  let schedules: Array<{
    scheduleId: string;
    title: string;
    nextDueDate: Date;
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
      .where(
        and(
          eq(assetPmScheduleTable.active, true),
          lte(assetPmScheduleTable.nextDueDate, new Date()),
        ),
      );
  } catch (error) {
    console.error("Failed to query PM schedules", error);
    return;
  }

  for (const s of schedules) {
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
        dueDate: s.nextDueDate,
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
