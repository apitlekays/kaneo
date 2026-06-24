import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  projectTable,
  taskCalendarEventTable,
  taskTable,
} from "../database/schema";
import { getConnection, getValidAccessToken } from "./connection";
import {
  type CalendarEventBody,
  deleteEvent,
  insertEvent,
  isGoogleCalendarConfigured,
  updateEvent,
} from "./google-client";

// Serialize syncs per task so rapid successive events (e.g. create then
// assignee-change) can't race into duplicate calendar events.
const taskLocks = new Map<string, Promise<unknown>>();

function runExclusive<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskLocks.get(taskId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  taskLocks.set(
    taskId,
    next.finally(() => {
      if (taskLocks.get(taskId) === next) taskLocks.delete(taskId);
    }),
  );
  return next;
}

function clientBaseUrl() {
  return (process.env.KANEO_CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

function buildEventBody(task: {
  title: string;
  description: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  workspaceId: string;
  projectId: string;
  projectName: string;
  id: string;
}): CalendarEventBody {
  const url = `${clientBaseUrl()}/dashboard/workspace/${task.workspaceId}/project/${task.projectId}/task/${task.id}`;
  const description = [
    task.description?.trim(),
    `Kaneo · ${task.projectName}`,
    url,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Timed block when a start date exists; otherwise an all-day event on the due date.
  if (task.startDate && task.dueDate) {
    const start = task.startDate;
    const end =
      task.dueDate.getTime() > start.getTime()
        ? task.dueDate
        : new Date(start.getTime() + 60 * 60 * 1000);
    return {
      summary: task.title,
      description,
      start: { dateTime: start.toISOString(), timeZone: "UTC" },
      end: { dateTime: end.toISOString(), timeZone: "UTC" },
      source: { title: "Kaneo", url },
    };
  }

  const due = task.dueDate as Date;
  const startDateOnly = due.toISOString().slice(0, 10);
  const endDate = new Date(`${startDateOnly}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return {
    summary: task.title,
    description,
    start: { date: startDateOnly },
    end: { date: endDate.toISOString().slice(0, 10) },
    source: { title: "Kaneo", url },
  };
}

async function getMapping(taskId: string) {
  const [row] = await db
    .select()
    .from(taskCalendarEventTable)
    .where(eq(taskCalendarEventTable.taskId, taskId))
    .limit(1);
  return row;
}

async function removeMapping(taskId: string) {
  await db
    .delete(taskCalendarEventTable)
    .where(eq(taskCalendarEventTable.taskId, taskId));
}

/** Best-effort delete of the calendar event referenced by a mapping. */
async function deleteMappedEvent(mapping: {
  userId: string;
  eventId: string;
  calendarId: string;
}) {
  try {
    const connection = await getConnection(mapping.userId);
    if (!connection) return;
    const token = await getValidAccessToken(connection);
    await deleteEvent(token, mapping.calendarId, mapping.eventId);
  } catch (err) {
    console.error("Failed to delete mapped calendar event:", err);
  }
}

/**
 * Reconcile a task with its Google Calendar event. Idempotent: creates,
 * updates, moves (on assignee change), or deletes the event so it matches the
 * task's current state. Best-effort — never throws to the caller.
 */
export async function syncTaskToCalendar(taskId: string): Promise<void> {
  if (!isGoogleCalendarConfigured()) return;

  return runExclusive(taskId, async () => {
    try {
      const [task] = await db
        .select({
          id: taskTable.id,
          title: taskTable.title,
          description: taskTable.description,
          status: taskTable.status,
          startDate: taskTable.startDate,
          dueDate: taskTable.dueDate,
          assigneeId: taskTable.userId,
          projectId: taskTable.projectId,
          projectName: projectTable.name,
          workspaceId: projectTable.workspaceId,
          columnIsFinal: columnTable.isFinal,
        })
        .from(taskTable)
        .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
        .leftJoin(
          columnTable,
          and(
            eq(columnTable.projectId, taskTable.projectId),
            eq(columnTable.slug, taskTable.status),
          ),
        )
        .where(eq(taskTable.id, taskId))
        .limit(1);

      const mapping = await getMapping(taskId);

      const isDone =
        task?.columnIsFinal === true || task?.status === "archived";
      const targetUserId = task?.assigneeId ?? null;
      const shouldExist = Boolean(
        task && targetUserId && task.dueDate && !isDone,
      );

      if (!shouldExist || !task || !targetUserId) {
        if (mapping) {
          await deleteMappedEvent(mapping);
          await removeMapping(taskId);
        }
        return;
      }

      const connection = await getConnection(targetUserId);
      if (!connection) {
        // Assignee has no connected calendar — drop any stale event.
        if (mapping) {
          await deleteMappedEvent(mapping);
          await removeMapping(taskId);
        }
        return;
      }

      const token = await getValidAccessToken(connection);
      const body = buildEventBody(task);

      // Assignee changed since last sync — remove the event from the old
      // calendar before creating it on the new one.
      if (mapping && mapping.userId !== targetUserId) {
        await deleteMappedEvent(mapping);
        await removeMapping(taskId);
      }

      const current = await getMapping(taskId);

      if (current && current.userId === targetUserId) {
        const updated = await updateEvent(
          token,
          current.calendarId,
          current.eventId,
          body,
        );
        if (updated) return;
        // Event vanished on Google's side — fall through to recreate.
        await removeMapping(taskId);
      }

      const created = await insertEvent(token, connection.calendarId, body);
      await db
        .insert(taskCalendarEventTable)
        .values({
          taskId,
          userId: targetUserId,
          eventId: created.id,
          calendarId: connection.calendarId,
        })
        .onConflictDoUpdate({
          target: taskCalendarEventTable.taskId,
          set: {
            userId: targetUserId,
            eventId: created.id,
            calendarId: connection.calendarId,
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      console.error(`Calendar sync failed for task ${taskId}:`, err);
    }
  });
}

/**
 * Remove a task's calendar event when the task itself is deleted (the row is
 * already gone, so we work from the mapping alone).
 */
export async function removeTaskFromCalendar(taskId: string): Promise<void> {
  if (!isGoogleCalendarConfigured()) return;
  return runExclusive(taskId, async () => {
    const mapping = await getMapping(taskId);
    if (!mapping) return;
    await deleteMappedEvent(mapping);
    await removeMapping(taskId);
  });
}

/** Re-sync every still-pending task assigned to a user (used right after they connect). */
export async function syncAllTasksForUser(userId: string): Promise<void> {
  if (!isGoogleCalendarConfigured()) return;
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(eq(taskTable.userId, userId));
  for (const row of rows) {
    await syncTaskToCalendar(row.id);
  }
}
