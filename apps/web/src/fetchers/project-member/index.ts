import { getApiUrl } from "@/fetchers/get-api-url";

export type ProjectMember = {
  userId: string;
  role: string;
  name: string;
  email: string;
  image: string | null;
};

export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMember[]> {
  const response = await fetch(getApiUrl(`project-member/${projectId}`), {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: "manager" | "member" = "member",
): Promise<{ success: boolean }> {
  const response = await fetch(getApiUrl(`project-member/${projectId}`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, role }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(
    getApiUrl(`project-member/${projectId}/${userId}`),
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export type ProjectAccessRequest = {
  userId: string;
  createdAt: string;
  name: string;
  email: string;
  image: string | null;
};

export async function requestProjectAccess(
  projectId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(
    getApiUrl(`project-member/${projectId}/request`),
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getProjectRequests(
  projectId: string,
): Promise<ProjectAccessRequest[]> {
  const response = await fetch(
    getApiUrl(`project-member/${projectId}/requests`),
    { credentials: "include" },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function approveProjectRequest(
  projectId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(
    getApiUrl(`project-member/${projectId}/requests/${userId}/approve`),
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function denyProjectRequest(
  projectId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(
    getApiUrl(`project-member/${projectId}/requests/${userId}`),
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
