import { createHmac } from "node:crypto";
import { sendNotificationEmail } from "@kaneo/email";
import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  driverProfileTable,
  letterTable,
  meetingTable,
  notificationTable,
  projectTable,
  registeredAssetTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { canReadMeeting, loadAttendeeUserIds } from "../meeting/access";
import { assertPublicWebhookDestination } from "../plugins/generic-webhook/config";
import { isGlobalAdmin } from "../utils/project-access";
import { decryptSecret } from "./secrets";

/**
 * The only notifications sent by email: someone is handed work (an offer
 * to accept, or an assignment) or work is due. Everything else stays
 * in-app and on the other channels. Email is on for these by default;
 * a user can still switch it off in Settings → Notifications.
 */
export const EMAIL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  // Offers — the recipient must accept or decline.
  "task_offered",
  "letter_assigned",
  "meeting_action_assigned",
  // Assignments — work handed to the recipient.
  "letter_action_assigned",
  "work_order_assigned",
  "task_tagged",
  // Reminders — work coming due.
  "due_date_reminder",
  "task_overdue",
  "asset_maintenance_due",
  "asset_renewal_reminder",
  "asset_rental_overdue",
]);

const DEFAULT_OUTBOUND_FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_OUTBOUND_FETCH_TIMEOUT_MS;
  const { timeoutMs: _timeout, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type ResolvedNotificationContext = {
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskUrl: string | null;
};

type DeliveryContent = {
  title: string;
  body: string;
};

function buildTaskUrl(workspaceId: string, projectId: string, taskId: string) {
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}

function buildLetterUrl(letterId: string) {
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}/dashboard/correspondence/${letterId}`;
}

function buildCategoryUrl(category: string) {
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}/dashboard/category/${category}`;
}

function workspaceOnlyContext(
  workspaceId: string,
  workspaceName: string,
  url: string | null,
): ResolvedNotificationContext {
  return {
    workspaceId,
    workspaceName,
    projectId: null,
    projectName: null,
    taskId: null,
    taskTitle: null,
    taskUrl: url,
  };
}

function getStringValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

function buildDeliveryContent(notification: {
  type: string;
  content: string | null;
  title: string | null;
  eventData: Record<string, unknown> | null;
}): DeliveryContent {
  if (notification.title && notification.content) {
    return {
      title: notification.title,
      body: notification.content,
    };
  }

  switch (notification.type) {
    case "task_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "New task created",
        body: taskTitle
          ? `A new task was created: ${taskTitle}`
          : "A new task was created in Kaneo.",
      };
    }
    case "workspace_created": {
      const workspaceName = getStringValue(
        notification.eventData,
        "workspaceName",
      );
      return {
        title: "Workspace created",
        body: workspaceName
          ? `Workspace created: ${workspaceName}`
          : "A new workspace was created in Kaneo.",
      };
    }
    case "task_status_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const oldStatus = getStringValue(notification.eventData, "oldStatus");
      const newStatus = getStringValue(notification.eventData, "newStatus");
      return {
        title: "Task status changed",
        body:
          taskTitle && oldStatus && newStatus
            ? `${taskTitle} moved from ${oldStatus} to ${newStatus}.`
            : "A task status changed in Kaneo.",
      };
    }
    case "task_assignee_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const actorName = getStringValue(notification.eventData, "actorName");
      // Mirrors apps/web/src/lib/notification-copy.ts: name the assigner
      // when known, and fall back to the neutral, unattributed phrasing
      // when they aren't (actorName resolves to the literal "Someone" for
      // grandfathered task_assignment rows from migration 0057 that never
      // recorded an assigner — inventing one here would be worse than
      // saying nothing).
      const isKnownActor = actorName !== null && actorName !== "Someone";
      if (!taskTitle) {
        return {
          title: "Task assigned to you",
          body: "A task was assigned to you in Kaneo.",
        };
      }
      return {
        title: "Task assigned to you",
        body: isKnownActor
          ? `${actorName} assigned you to "${taskTitle}".`
          : `You were assigned to "${taskTitle}".`,
      };
    }
    case "time_entry_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Time entry created",
        body: taskTitle
          ? `A time entry was created for ${taskTitle}.`
          : "A time entry was created in Kaneo.",
      };
    }
    case "due_date_reminder": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const reminderType = getStringValue(
        notification.eventData,
        "reminderType",
      );
      const label =
        reminderType === "one_hour_before" ? "in 1 hour" : "in 1 day";
      return {
        title: "Task due soon",
        body: taskTitle
          ? `"${taskTitle}" is due ${label}.`
          : `A task is due ${label}.`,
      };
    }
    case "task_overdue": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task overdue",
        body: taskTitle
          ? `"${taskTitle}" is past its due date.`
          : "A task is past its due date.",
      };
    }
    default:
      return {
        title: notification.title ?? "New Kaneo notification",
        body: notification.content ?? "You have a new notification in Kaneo.",
      };
  }
}

async function resolveNotificationContext(notification: {
  userId: string;
  resourceType: string | null;
  resourceId: string | null;
}): Promise<ResolvedNotificationContext | null> {
  if (!notification.resourceType || !notification.resourceId) {
    return null;
  }

  if (notification.resourceType === "meeting") {
    const [meeting] = await db
      .select({
        id: meetingTable.id,
        confidential: meetingTable.confidential,
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(meetingTable)
      .innerJoin(
        workspaceTable,
        eq(meetingTable.workspaceId, workspaceTable.id),
      )
      .where(eq(meetingTable.id, notification.resourceId))
      .limit(1);
    if (!meeting) return null;

    // A confidential meeting's title has escaped through a notification
    // subject before. Nothing leaves the app — email or any other channel —
    // unless the recipient can read the meeting.
    if (meeting.confidential) {
      const readable = canReadMeeting({
        confidential: true,
        attendeeUserIds: await loadAttendeeUserIds(meeting.id),
        userId: notification.userId,
        isGlobalAdmin: await isGlobalAdmin(
          notification.userId,
          meeting.workspaceId,
        ),
      });
      if (!readable) return null;
    }

    return workspaceOnlyContext(
      meeting.workspaceId,
      meeting.workspaceName,
      buildCategoryUrl("general-management"),
    );
  }

  if (notification.resourceType === "asset") {
    const [asset] = await db
      .select({
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(registeredAssetTable)
      .innerJoin(
        workspaceTable,
        eq(registeredAssetTable.workspaceId, workspaceTable.id),
      )
      .where(eq(registeredAssetTable.id, notification.resourceId))
      .limit(1);
    if (!asset) return null;
    return workspaceOnlyContext(
      asset.workspaceId,
      asset.workspaceName,
      buildCategoryUrl("assets-management"),
    );
  }

  if (notification.resourceType === "driver") {
    const [driver] = await db
      .select({
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(driverProfileTable)
      .innerJoin(
        workspaceTable,
        eq(driverProfileTable.workspaceId, workspaceTable.id),
      )
      .where(eq(driverProfileTable.id, notification.resourceId))
      .limit(1);
    if (!driver) return null;
    return workspaceOnlyContext(
      driver.workspaceId,
      driver.workspaceName,
      buildCategoryUrl("assets-management"),
    );
  }

  if (notification.resourceType === "task") {
    const [task] = await db
      .select({
        taskId: taskTable.id,
        taskTitle: taskTable.title,
        projectId: projectTable.id,
        projectName: projectTable.name,
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(eq(taskTable.id, notification.resourceId))
      .limit(1);

    if (!task) {
      return null;
    }

    return {
      workspaceId: task.workspaceId,
      workspaceName: task.workspaceName,
      projectId: task.projectId,
      projectName: task.projectName,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      taskUrl: buildTaskUrl(task.workspaceId, task.projectId, task.taskId),
    };
  }

  if (notification.resourceType === "letter") {
    const [letter] = await db
      .select({
        letterId: letterTable.id,
        subject: letterTable.subject,
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(letterTable)
      .innerJoin(workspaceTable, eq(letterTable.workspaceId, workspaceTable.id))
      .where(eq(letterTable.id, notification.resourceId))
      .limit(1);

    if (!letter) {
      return null;
    }

    // Reuse the generic action-URL slot (taskUrl) so the existing email/ntfy/
    // gotify/webhook delivery paths surface an "Open" link to the letter.
    return {
      workspaceId: letter.workspaceId,
      workspaceName: letter.workspaceName,
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: letter.subject,
      taskUrl: buildLetterUrl(letter.letterId),
    };
  }

  if (notification.resourceType === "workspace") {
    const [workspace] = await db
      .select({
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, notification.resourceId))
      .limit(1);

    if (!workspace) {
      return null;
    }

    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: null,
      taskUrl: null,
    };
  }

  return null;
}

async function sendNtfyNotification(input: {
  serverUrl: string;
  topic: string;
  token?: string | null;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  await assertPublicWebhookDestination(input.serverUrl);

  const response = await fetchWithTimeout(
    `${input.serverUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.topic)}`,
    {
      method: "POST",
      headers: {
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(input.clickUrl ? { Click: input.clickUrl } : {}),
        Title: input.title,
      },
      body: input.body,
    },
  );

  if (!response.ok) {
    throw new Error(
      `ntfy delivery failed (${response.status}): ${await response.text()}`,
    );
  }
}

async function sendGotifyNotification(input: {
  serverUrl: string;
  token: string;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  await assertPublicWebhookDestination(input.serverUrl);

  // Gotify expects the app token in the query string; that can surface in logs, proxies, and browser history — factor this into Gotify placement and log handling.
  const response = await fetchWithTimeout(
    `${input.serverUrl.replace(/\/+$/, "")}/message?token=${encodeURIComponent(
      input.token,
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        message: input.body,
        priority: 5,
        extras: input.clickUrl
          ? {
              "client::notification": {
                click: {
                  url: input.clickUrl,
                },
              },
              "client::display": {
                contentType: "text/plain",
              },
            }
          : undefined,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gotify delivery failed (${response.status}): ${await response.text()}`,
    );
  }
}

async function sendWebhookNotification(input: {
  webhookUrl: string;
  secret?: string | null;
  payload: Record<string, unknown>;
}) {
  await assertPublicWebhookDestination(input.webhookUrl);

  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.secret) {
    headers["X-Kaneo-Signature"] = createHmac("sha256", input.secret)
      .update(body)
      .digest("hex");
  }

  const response = await fetchWithTimeout(input.webhookUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Webhook delivery failed (${response.status}): ${await response.text()}`,
    );
  }
}

type DeliveryRule = {
  isActive: boolean;
  emailEnabled: boolean;
  ntfyEnabled: boolean;
  gotifyEnabled: boolean;
  webhookEnabled: boolean;
  projectMode: string;
  selectedProjectIds: string[];
};

type DeliveryPreference = {
  emailEnabled: boolean;
  ntfyEnabled: boolean;
  gotifyEnabled: boolean;
  webhookEnabled: boolean;
};

/**
 * Which channels one notification goes out on.
 *
 * Email is **on by default** for the types in EMAIL_NOTIFICATION_TYPES: a
 * user who has never opened notification settings (no preference row) or
 * never configured a workspace (no rule) still gets it. Whatever they have
 * saved wins — turning email off, pausing a workspace, or narrowing it to
 * selected projects.
 *
 * ntfy, Gotify and webhooks stay opt-in: they need an account-level switch
 * and a workspace rule, as before.
 *
 * "Selected projects" narrows project notifications only. A letter, meeting
 * or asset has no project, so it is never filtered out by project scope.
 */
export function resolveDeliveryChannels(input: {
  type: string;
  hasEmailAddress: boolean;
  preference: DeliveryPreference | null;
  rule: DeliveryRule | null;
  projectId: string | null;
}): { email: boolean; ntfy: boolean; gotify: boolean; webhook: boolean } {
  const { preference, rule, projectId } = input;

  const inProjectScope =
    !rule ||
    rule.projectMode !== "selected" ||
    !projectId ||
    rule.selectedProjectIds.includes(projectId);
  const workspaceAllows = (rule ? rule.isActive : true) && inProjectScope;

  const email =
    EMAIL_NOTIFICATION_TYPES.has(input.type) &&
    input.hasEmailAddress &&
    (preference?.emailEnabled ?? true) &&
    workspaceAllows &&
    (rule ? rule.emailEnabled : true);

  const optIn = (account?: boolean, workspace?: boolean) =>
    Boolean(account && rule && workspaceAllows && workspace);

  return {
    email,
    ntfy: optIn(preference?.ntfyEnabled, rule?.ntfyEnabled),
    gotify: optIn(preference?.gotifyEnabled, rule?.gotifyEnabled),
    webhook: optIn(preference?.webhookEnabled, rule?.webhookEnabled),
  };
}

export async function deliverNotification(
  notificationId: string,
): Promise<void> {
  const notification = await db.query.notificationTable.findFirst({
    where: eq(notificationTable.id, notificationId),
  });

  if (!notification) {
    return;
  }

  const context = await resolveNotificationContext(notification);
  if (!context) {
    console.info("Notification delivery skipped: unresolved context", {
      notificationId,
      notificationTableId: notification.id,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      reason:
        "resolveNotificationContext returned null (missing resource, deleted task, or unsupported resource type)",
    });
    return;
  }

  const [user] = await db
    .select({
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, notification.userId))
    .limit(1);

  if (!user) {
    return;
  }

  const preference = await db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, notification.userId),
  });

  const rule = await db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, notification.userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, context.workspaceId),
    ),
    with: {
      selectedProjects: true,
    },
  });

  const channels = resolveDeliveryChannels({
    type: notification.type,
    hasEmailAddress: Boolean(user.email),
    preference: preference ?? null,
    rule: rule
      ? {
          isActive: rule.isActive,
          emailEnabled: rule.emailEnabled,
          ntfyEnabled: rule.ntfyEnabled,
          gotifyEnabled: rule.gotifyEnabled,
          webhookEnabled: rule.webhookEnabled,
          projectMode: rule.projectMode,
          selectedProjectIds: rule.selectedProjects.map((p) => p.projectId),
        }
      : null,
    projectId: context.projectId,
  });

  if (!Object.values(channels).some(Boolean)) {
    return;
  }

  const decryptedPreference = {
    ntfyServerUrl: preference?.ntfyServerUrl ?? null,
    ntfyTopic: preference?.ntfyTopic ?? null,
    ntfyToken: decryptSecret(preference?.ntfyToken ?? null),
    gotifyServerUrl: preference?.gotifyServerUrl ?? null,
    gotifyToken: decryptSecret(preference?.gotifyToken ?? null),
    webhookUrl: preference?.webhookUrl ?? null,
    webhookSecret: decryptSecret(preference?.webhookSecret ?? null),
  };

  const content = buildDeliveryContent({
    type: notification.type,
    title: notification.title ?? null,
    content: notification.content ?? null,
    eventData:
      notification.eventData && typeof notification.eventData === "object"
        ? (notification.eventData as Record<string, unknown>)
        : null,
  });

  const webhookPayload = {
    notification: {
      id: notification.id,
      type: notification.type,
      title: content.title,
      content: content.body,
      createdAt: notification.createdAt,
      eventData: notification.eventData,
      resourceId: notification.resourceId,
      resourceType: notification.resourceType,
    },
    workspace: {
      id: context.workspaceId,
      name: context.workspaceName,
    },
    project: context.projectId
      ? {
          id: context.projectId,
          name: context.projectName,
        }
      : null,
    task: context.taskId
      ? {
          id: context.taskId,
          title: context.taskTitle,
          url: context.taskUrl,
        }
      : null,
    user: {
      id: notification.userId,
      email: user.email,
      name: user.name,
    },
  };

  // Only fulfilled/rejected status is inspected below, not the resolved
  // value, so the array only needs to hold promises, not agree on a value
  // type — sendNotificationEmail resolves with an EmailResult, the others
  // with void.
  const deliveries: Array<Promise<unknown>> = [];

  if (channels.email && user.email) {
    deliveries.push(
      sendNotificationEmail(user.email, content.title, {
        title: content.title,
        message: content.body,
        actionUrl: context.taskUrl,
        actionLabel: context.taskUrl ? "Open in MAPIMCore" : undefined,
        locale: user.locale ?? null,
      }),
    );
  }

  if (
    channels.ntfy &&
    decryptedPreference.ntfyServerUrl &&
    decryptedPreference.ntfyTopic
  ) {
    deliveries.push(
      sendNtfyNotification({
        serverUrl: decryptedPreference.ntfyServerUrl,
        topic: decryptedPreference.ntfyTopic,
        token: decryptedPreference.ntfyToken,
        title: content.title,
        body: content.body,
        clickUrl: context.taskUrl,
      }),
    );
  }

  if (
    channels.gotify &&
    decryptedPreference.gotifyServerUrl &&
    decryptedPreference.gotifyToken
  ) {
    deliveries.push(
      sendGotifyNotification({
        serverUrl: decryptedPreference.gotifyServerUrl,
        token: decryptedPreference.gotifyToken,
        title: content.title,
        body: content.body,
        clickUrl: context.taskUrl,
      }),
    );
  }

  if (channels.webhook && decryptedPreference.webhookUrl) {
    deliveries.push(
      sendWebhookNotification({
        webhookUrl: decryptedPreference.webhookUrl,
        secret: decryptedPreference.webhookSecret,
        payload: webhookPayload,
      }),
    );
  }

  const results = await Promise.allSettled(deliveries);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Notification delivery failed", {
        notificationId,
        error: result.reason,
      });
    }
  }
}
