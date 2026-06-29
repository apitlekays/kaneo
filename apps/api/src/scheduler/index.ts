import { Cron } from "croner";
import { checkAssetRemindersDue } from "./asset-reminders";
import { checkDueDateReminders } from "./due-date-reminders";

const jobs: Cron[] = [];

export function initializeScheduler(): void {
  jobs.push(new Cron("*/5 * * * *", checkDueDateReminders));
  // Asset renewal reminders — daily at 08:00 (server time).
  jobs.push(new Cron("0 8 * * *", checkAssetRemindersDue));
  console.log(
    "⏰ Scheduler started (task reminders every 5 min; asset reminders daily 08:00)",
  );
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
