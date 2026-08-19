import { getStatusLabel } from "@/lib/i18n/domain";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * The fields notification copy is built from. Deliberately structural rather
 * than the full `Notification` row: the app-wide alert surface maps the hono
 * response down to what it needs, and the bell passes the whole row. Both fit
 * here, so the copy lives in one place instead of two.
 */
export type NotificationCopySource = {
  type: string;
  title?: string | null;
  content?: string | null;
  eventData?: unknown;
};

function getEventDataRecord(
  eventData: unknown,
): Record<string, unknown> | null {
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return null;
  }

  return eventData as Record<string, unknown>;
}

/**
 * Human title for a notification. Most producers write no `title` column at
 * all, so without this the surface prints the raw enum ("task_commented") at
 * the user.
 */
export function getNotificationTitle(
  notification: NotificationCopySource,
  t: TranslateFn,
) {
  const eventData = getEventDataRecord(notification.eventData);
  if (eventData) {
    switch (notification.type) {
      case "task_created":
        return t("notifications:events.task_created.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "workspace_created":
        return t("notifications:events.workspace_created.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_status_changed":
        return t("notifications:events.task_status_changed.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_assignee_changed":
        return t("notifications:events.task_assignee_changed.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "time_entry_created":
        return t("notifications:events.time_entry_created.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_tagged":
        return t("notifications:events.task_tagged.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_commented":
        return t("notifications:events.task_commented.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "due_date_reminder":
        return t("notifications:events.due_date_reminder.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_overdue":
        return t("notifications:events.task_overdue.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      default:
        break;
    }
  }

  return notification.title ?? notification.type;
}

export function getNotificationContent(
  notification: NotificationCopySource,
  t: TranslateFn,
) {
  const eventData = getEventDataRecord(notification.eventData);
  if (eventData) {
    switch (notification.type) {
      case "task_created":
        return t("notifications:events.task_created.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "workspace_created":
        return t("notifications:events.workspace_created.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "task_status_changed":
        return t("notifications:events.task_status_changed.content", {
          ...eventData,
          oldStatus: getStatusLabel(String(eventData.oldStatus ?? "")),
          newStatus: getStatusLabel(String(eventData.newStatus ?? "")),
          defaultValue: notification.content ?? "",
        });
      case "task_assignee_changed":
        return t("notifications:events.task_assignee_changed.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "time_entry_created":
        return eventData.taskTitle
          ? t("notifications:events.time_entry_created.contentWithTask", {
              ...eventData,
              defaultValue: notification.content ?? "",
            })
          : t("notifications:events.time_entry_created.contentWithoutTask", {
              ...eventData,
              defaultValue: notification.content ?? "",
            });
      case "task_tagged":
        return t("notifications:events.task_tagged.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "task_commented":
        return t("notifications:events.task_commented.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "due_date_reminder":
        return eventData.reminderType === "one_hour_before"
          ? t("notifications:events.due_date_reminder.contentOneHour", {
              ...eventData,
              defaultValue: notification.content ?? "",
            })
          : t("notifications:events.due_date_reminder.contentOneDay", {
              ...eventData,
              defaultValue: notification.content ?? "",
            });
      case "task_overdue":
        return t("notifications:events.task_overdue.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      default:
        break;
    }
  }

  return notification.content ?? "";
}
