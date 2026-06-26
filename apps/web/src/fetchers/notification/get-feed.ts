import { getApiUrl } from "@/fetchers/get-api-url";

export type NotificationFeedType =
  | "task_assignee_changed"
  | "task_tagged"
  | "task_status_changed"
  | "task_commented";

export type NotificationFeedItem = {
  id: string;
  type: NotificationFeedType;
  eventData: { actorName?: string; taskTitle?: string } | null;
  isRead: boolean | null;
  createdAt: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  workspaceId: string;
};

export async function getNotificationFeed(): Promise<NotificationFeedItem[]> {
  const response = await fetch(getApiUrl("notification/feed"), {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
