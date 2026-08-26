import { createId } from "@paralleldrive/cuid2";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deliverNotification } from "../../notification-preferences/delivery";
import { trackBackgroundWork } from "../../utils/background-work";
import { broadcastToUser } from "../../ws";

async function createNotification({
  userId,
  title,
  content,
  type,
  eventData,
  resourceId,
  resourceType,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
}) {
  const [notification] = await db
    .insert(notificationTable)
    .values({
      id: createId(),
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: eventData ?? null,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
    })
    .returning();

  if (notification) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    });
    // Delivery must stay fire-and-forget in production (the request must not
    // wait on email/webhook/etc. delivery) but it still runs DB queries
    // after this function has already returned — see
    // `apps/api/src/utils/background-work.ts` for why that needs to be
    // observable to test harnesses.
    trackBackgroundWork(
      deliverNotification(notification.id).catch((error) => {
        console.error("Failed to deliver notification", {
          notificationId: notification.id,
          error,
        });
      }),
    );

    // Instant push: nudge the recipient's user channel so their bell badge and
    // Home activity feed update immediately (no 60s wait).
    broadcastToUser(userId, { entity: "notification" });
  }

  return notification;
}

export default createNotification;
