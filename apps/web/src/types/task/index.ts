type TaskLabel = {
  id: string;
  name: string;
  color: string;
};

type TaskExternalLink = {
  id: string;
  taskId: string;
  integrationId: string;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
};

export type TaskAssignee = {
  userId: string;
  name: string | null;
  image: string | null;
  isLead: boolean;
};

export type TaskPendingAssignee = {
  userId: string;
  name: string | null;
};

type Task = {
  id: string;
  title: string;
  number: number | null;
  description: string | null;
  status: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  position: number | null;
  createdAt: string;
  updatedAt?: string;
  /** The lead. Everyone on the task is in `assignees`. */
  userId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage?: string | null;
  /** @deprecated single-value view of `pendingAssignees`. */
  pendingAssigneeName?: string | null;
  /** Everyone who has accepted the task, lead first. */
  assignees?: TaskAssignee[];
  /** Everyone the task is offered to and who hasn't decided yet. */
  pendingAssignees?: TaskPendingAssignee[];
  projectId: string;
  columnId?: string | null;
  labels?: TaskLabel[];
  externalLinks?: TaskExternalLink[];
};

export default Task;
