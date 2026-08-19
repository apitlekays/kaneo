import { describe, expect, it } from "vitest";
import { i18n } from "@/lib/i18n";
import {
  getNotificationContent,
  getNotificationTitle,
} from "@/lib/notification-copy";

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, options) as unknown as string;

describe("notification copy", () => {
  // The API writes a `title` column for almost nothing. Every one of these
  // types arrives with title null, so a missing case here means the bell and
  // the toast print the raw enum at the user.
  it.each([
    [
      "task_tagged",
      { actorName: "Ada", taskTitle: "Ship the thing" },
      "You were tagged",
      'Ada tagged you in "Ship the thing"',
    ],
    [
      "task_commented",
      { actorName: "Ada", taskTitle: "Ship the thing" },
      "New comment",
      'Ada commented on "Ship the thing"',
    ],
    [
      "due_date_reminder",
      { taskTitle: "Ship the thing", reminderType: "one_hour_before" },
      "Task due soon",
      '"Ship the thing" is due in 1 hour',
    ],
    [
      "task_overdue",
      { taskTitle: "Ship the thing" },
      "Task overdue",
      '"Ship the thing" is past its due date',
    ],
  ])("renders human title and content for %s with no title column", (type, eventData, title, content) => {
    const notification = { type, title: null, content: null, eventData };

    expect(getNotificationTitle(notification, t)).toBe(title);
    expect(getNotificationContent(notification, t)).toBe(content);
  });

  it("uses the one-day copy for a day-out due reminder", () => {
    const notification = {
      type: "due_date_reminder",
      title: null,
      content: null,
      eventData: {
        taskTitle: "Ship the thing",
        reminderType: "one_day_before",
      },
    };

    expect(getNotificationContent(notification, t)).toBe(
      '"Ship the thing" is due in 1 day',
    );
  });

  it("still falls back to the stored title for an unknown type", () => {
    const notification = {
      type: "letter_assigned",
      title: "Letter assigned",
      content: "A letter needs you",
      eventData: { letterId: "l1" },
    };

    expect(getNotificationTitle(notification, t)).toBe("Letter assigned");
    expect(getNotificationContent(notification, t)).toBe("A letter needs you");
  });
});
