import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import { subscribeToEvent } from "../events";
import { notificationSchema } from "../schemas";
import clearNotifications from "./controllers/clear-notifications";
import createNotification from "./controllers/create-notification";
import getNotifications from "./controllers/get-notifications";
import markAllNotificationsAsRead from "./controllers/mark-all-notifications-as-read";
import markAsRead from "./controllers/mark-notification-as-read";

const bulkResultSchema = v.object({
  success: v.boolean(),
  count: v.optional(v.number()),
});

// Resolve a display name for the actor who triggered an event, so feed
// notifications can read "<actorName> did X". Events carry the actor as
// `userId`; notifications don't have an actor column, so we stash the name in
// eventData at creation time.
async function getActorName(userId: string): Promise<string> {
  const [actor] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return actor?.name ?? "Someone";
}

// Notification types shown in the Home activity feed (the "X did Y in Task Z"
// list). All reference a task and carry an actorName in eventData.
const FEED_TYPES = [
  "task_assignee_changed",
  "task_tagged",
  "task_status_changed",
  "task_commented",
] as const;

const notification = new Hono<{
  Variables: {
    userId: string;
  };
}>()
  .get(
    "/",
    describeRoute({
      operationId: "listNotifications",
      tags: ["Notifications"],
      description: "Get all notifications for the current user",
      responses: {
        200: {
          description: "List of notifications",
          content: {
            "application/json": {
              schema: resolver(v.array(notificationSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      const notifications = await getNotifications(userId);
      return c.json(notifications);
    },
  )
  .get(
    "/feed",
    describeRoute({
      operationId: "getNotificationFeed",
      tags: ["Notifications"],
      description:
        "Task-linked activity feed for the current user (tagged/assigned/etc.)",
      responses: {
        200: {
          description: "Feed items enriched with task + project context",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");

      const rows = await db
        .select({
          id: notificationTable.id,
          type: notificationTable.type,
          eventData: notificationTable.eventData,
          isRead: notificationTable.isRead,
          createdAt: notificationTable.createdAt,
          taskId: notificationTable.resourceId,
          taskTitle: taskTable.title,
          projectId: taskTable.projectId,
          workspaceId: projectTable.workspaceId,
        })
        .from(notificationTable)
        .innerJoin(taskTable, eq(notificationTable.resourceId, taskTable.id))
        .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
        .where(
          and(
            eq(notificationTable.userId, userId),
            eq(notificationTable.resourceType, "task"),
            inArray(notificationTable.type, [...FEED_TYPES]),
          ),
        )
        .orderBy(desc(notificationTable.createdAt))
        .limit(40);

      return c.json(rows);
    },
  )
  .post(
    "/",
    describeRoute({
      operationId: "createNotification",
      tags: ["Notifications"],
      description: "Create a new notification for a user",
      responses: {
        200: {
          description: "Notification created successfully",
          content: {
            "application/json": { schema: resolver(notificationSchema) },
          },
        },
      },
    }),
    validator(
      "json",
      v.object({
        title: v.optional(v.nullable(v.string())),
        message: v.optional(v.nullable(v.string())),
        type: v.string(),
        eventData: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
        relatedEntityId: v.optional(v.string()),
        relatedEntityType: v.optional(v.string()),
      }),
    ),
    async (c) => {
      const {
        title,
        message,
        type,
        eventData,
        relatedEntityId,
        relatedEntityType,
      } = c.req.valid("json");
      const userId = c.get("userId");
      const notification = await createNotification({
        userId,
        title,
        content: message,
        type,
        eventData,
        resourceId: relatedEntityId,
        resourceType: relatedEntityType,
      });
      return c.json(notification);
    },
  )
  .patch(
    "/:id/read",
    describeRoute({
      operationId: "markNotificationAsRead",
      tags: ["Notifications"],
      description: "Mark a specific notification as read",
      responses: {
        200: {
          description: "Notification marked as read",
          content: {
            "application/json": { schema: resolver(notificationSchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const notification = await markAsRead(id, userId);
      return c.json(notification);
    },
  )
  .patch(
    "/read-all",
    describeRoute({
      operationId: "markAllNotificationsAsRead",
      tags: ["Notifications"],
      description: "Mark all notifications as read for the current user",
      responses: {
        200: {
          description: "All notifications marked as read",
          content: {
            "application/json": { schema: resolver(bulkResultSchema) },
          },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      const result = await markAllNotificationsAsRead(userId);
      return c.json(result);
    },
  )
  .delete(
    "/clear-all",
    describeRoute({
      operationId: "clearAllNotifications",
      tags: ["Notifications"],
      description: "Clear all notifications for the current user",
      responses: {
        200: {
          description: "All notifications cleared",
          content: {
            "application/json": { schema: resolver(bulkResultSchema) },
          },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      const result = await clearNotifications(userId);
      return c.json(result);
    },
  );

subscribeToEvent<{
  taskId: string;
  userId: string;
  title: string;
  projectId: string;
}>("task.created", async (data) => {
  if (data.userId) {
    await createNotification({
      userId: data.userId,
      type: "task_created",
      eventData: {
        taskTitle: data.title,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }
});

subscribeToEvent<{
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  ownerId?: string;
}>("workspace.created", async (data) => {
  if (data.ownerId) {
    await createNotification({
      userId: data.ownerId,
      type: "workspace_created",
      eventData: {
        workspaceName: data.workspaceName,
      },
      resourceId: data.workspaceId,
      resourceType: "workspace",
    });
  }
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldStatus: string;
  newStatus: string;
  title: string;
  assigneeId?: string;
}>("task.status_changed", async (data) => {
  if (data.assigneeId && data.assigneeId !== data.userId) {
    await createNotification({
      userId: data.assigneeId,
      type: "task_status_changed",
      eventData: {
        actorName: await getActorName(data.userId),
        taskTitle: data.title,
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldAssignee: string | null;
  newAssignee: string;
  newAssigneeId: string;
  title: string;
}>("task.assignee_changed", async (data) => {
  if (data.newAssigneeId && data.newAssigneeId !== data.userId) {
    await createNotification({
      userId: data.newAssigneeId,
      type: "task_assignee_changed",
      eventData: {
        actorName: await getActorName(data.userId),
        taskTitle: data.title,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }
});

// Notify the task's assignee when someone else comments on their task.
subscribeToEvent<{
  taskId: string;
  userId: string; // the commenter
}>("task.comment_created", async (data) => {
  if (!data.taskId || !data.userId) return;

  const [task] = await db
    .select({ title: taskTable.title, assigneeId: taskTable.userId })
    .from(taskTable)
    .where(eq(taskTable.id, data.taskId))
    .limit(1);

  if (!task?.assigneeId || task.assigneeId === data.userId) return;

  await createNotification({
    userId: task.assigneeId,
    type: "task_commented",
    eventData: {
      actorName: await getActorName(data.userId),
      taskTitle: task.title,
    },
    resourceId: data.taskId,
    resourceType: "task",
  });
});

subscribeToEvent<{
  timeEntryId: string;
  taskId: string;
  userId: string;
  taskOwnerId?: string;
  taskTitle?: string;
}>("time-entry.created", async (data) => {
  if (data.taskOwnerId && data.taskOwnerId !== data.userId) {
    await createNotification({
      userId: data.taskOwnerId,
      type: "time_entry_created",
      eventData: {
        taskTitle: data.taskTitle ?? null,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }
});

export default notification;
