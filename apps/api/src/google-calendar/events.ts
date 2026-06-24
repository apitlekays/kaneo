import { subscribeToEvent } from "../events";
import { removeTaskFromCalendar, syncTaskToCalendar } from "./sync";

// Task events that can change whether/how a task maps to a calendar event.
const SYNC_EVENTS = [
  "task.created",
  "task.updated",
  "task.due_date_changed",
  "task.start_date_changed",
  "task.title_changed",
  "task.description_changed",
  "task.assignee_changed",
  "task.unassigned",
  "task.status_changed",
  "task.moved",
];

/**
 * Wire the one-way Kaneo → Google Calendar sync into the task event bus.
 * Called once at startup. Sync calls are no-ops when Google isn't configured.
 */
export function registerGoogleCalendarSync() {
  for (const eventName of SYNC_EVENTS) {
    subscribeToEvent<{ taskId?: string }>(eventName, async (data) => {
      if (data?.taskId) await syncTaskToCalendar(data.taskId);
    });
  }

  subscribeToEvent<{ taskId?: string }>("task.deleted", async (data) => {
    if (data?.taskId) await removeTaskFromCalendar(data.taskId);
  });
}
