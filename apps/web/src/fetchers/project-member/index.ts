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
