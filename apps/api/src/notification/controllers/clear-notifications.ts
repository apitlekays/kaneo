import { and, eq, notInArray } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { FEED_TYPES } from "../feed-types";

/**
 * Clears the notification bell. Deliberately spares the rows the Home
 * activity feed reads from the same table: "clear all" in the bell must not
 * erase a user's activity history, which nothing can restore.
 */
async function clearNotifications(userId: string) {
  await db
    .delete(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        notInArray(notificationTable.type, [...FEED_TYPES]),
      ),
    );

  return { success: true };
}

export default clearNotifications;
