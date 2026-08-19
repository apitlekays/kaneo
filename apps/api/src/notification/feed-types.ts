/**
 * Notification types shown in the Home activity feed (the "X did Y in Task Z"
 * list). All reference a task and carry an actorName in eventData.
 *
 * Lives in its own module so the feed query and the bell's "clear all" can
 * agree on the list without importing each other.
 */
export const FEED_TYPES = [
  "task_assignee_changed",
  "task_tagged",
  "task_status_changed",
  "task_commented",
] as const;
