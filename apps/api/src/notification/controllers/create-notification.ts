import { createId } from "@paralleldrive/cuid2";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deliverNotification } from "../../notification-preferences/delivery";
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
    void deliverNotification(notification.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: notification.id,
        error,
      });
    });

    // Instant push: nudge the recipient's user channel so their bell badge and
    // Home activity feed update immediately (no 60s wait).
    broadcastToUser(userId, { entity: "notification" });
  }

  return notification;
}

export default createNotification;
