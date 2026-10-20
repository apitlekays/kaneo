import { getApiUrl } from "@/fetchers/get-api-url";

/** All money is in sen (RM x 100). */
export type ProjectDetails = {
  id: string;
  kind: string;
  description: string | null;
  budget: number | null;
  revenue: number | null;
  /** Sum of every cost entry on the project's tasks and subtasks. */
  expenditure: number;
  createdBy: string | null;
  canEdit: boolean;
};

export type TaskCost = {
  id: string;
  description: string;
  amount: number;
  incurredOn: string;
  receiptFilename: string | null;
  receiptMimeType: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  canEdit: boolean;
};

export type ReceiptRef = {
  objectKey: string;
  filename: string;
  mimeType: string;
  size: number;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    credentials: "include",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // Plain-text error body.
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.json();
}

export const getProjectDetails = (projectId: string) =>
  call<ProjectDetails>(`project-details/${projectId}`);

export const updateProjectDetails = (
  projectId: string,
  body: {
    description?: string;
    budget?: number | null;
    revenue?: number | null;
  },
) =>
  call<{ ok: true }>(`project-details/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const listTaskCosts = (taskId: string) =>
  call<{ canAdd: boolean; items: TaskCost[] }>(`task-cost/task/${taskId}`);

export type TaskCostInput = {
  description: string;
  amount: number;
  /** YYYY-MM-DD */
  incurredOn: string;
  receipt?: ReceiptRef | null;
};

export const createTaskCost = (taskId: string, body: TaskCostInput) =>
  call<{ id: string }>(`task-cost/task/${taskId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateTaskCost = (
  taskId: string,
  costId: string,
  body: Partial<TaskCostInput>,
) =>
  call<{ ok: true }>(`task-cost/task/${taskId}/${costId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const deleteTaskCost = (taskId: string, costId: string) =>
  call<{ ok: true }>(`task-cost/task/${taskId}/${costId}`, {
    method: "DELETE",
  });

export const taskCostReceiptUrl = (taskId: string, costId: string) =>
  getApiUrl(`task-cost/task/${taskId}/${costId}/receipt`);

/** Upload a receipt straight to storage; the cost entry then refers to it. */
export async function uploadTaskCostReceipt(
  taskId: string,
  file: File,
): Promise<ReceiptRef> {
  const mimeType = file.type || "application/octet-stream";
  const presign = await call<{
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>(`task-cost/task/${taskId}/receipt/presign`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, mimeType, size: file.size }),
  });
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: file,
  });
  if (!put.ok) throw new Error("The receipt could not be uploaded");
  return {
    objectKey: presign.key,
    filename: file.name,
    mimeType,
    size: file.size,
  };
}
