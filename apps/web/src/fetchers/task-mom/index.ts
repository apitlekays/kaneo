import { getApiUrl } from "@/fetchers/get-api-url";

export type MomPerson = {
  id: string;
  userId: string | null;
  name: string;
};

export type MomRow = {
  id: string;
  agenda: string;
  discussion: string;
  action: string;
  taggedUserIds: string[];
  subtaskId?: string | null;
};

export type MomData = {
  date: string | null;
  time: string | null;
  attendees: MomPerson[];
  absentees: MomPerson[];
  rows: MomRow[];
};

export type TaskMom = {
  id: string;
  taskId: string;
  data: MomData;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export function emptyMomData(): MomData {
  return { date: null, time: null, attendees: [], absentees: [], rows: [] };
}

export async function getTaskMom(taskId: string): Promise<TaskMom | null> {
  const response = await fetch(getApiUrl(`task-mom/${taskId}`), {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function saveTaskMom(
  taskId: string,
  data: MomData,
): Promise<TaskMom> {
  const response = await fetch(getApiUrl(`task-mom/${taskId}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
