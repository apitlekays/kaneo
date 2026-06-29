import { getApiUrl } from "@/fetchers/get-api-url";

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
};

export type PageAccessGrant = {
  userId: string;
  pageSlug: string;
};

/** The current user's own accessible page slugs (admins get everything). */
export async function getMyPageAccess(
  workspaceId: string,
): Promise<{ pages: string[]; isAdmin: boolean }> {
  const response = await fetch(
    getApiUrl(`workspace-access/${workspaceId}/me`),
    { credentials: "include" },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** The full access matrix for the workspace (owner/global-admin only). */
export async function getPageAccessMatrix(
  workspaceId: string,
): Promise<{ grants: PageAccessGrant[] }> {
  const response = await fetch(getApiUrl(`workspace-access/${workspaceId}`), {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** Toggle one matrix cell (owner/global-admin only). */
export async function setPageAccess(
  workspaceId: string,
  userId: string,
  pageSlug: string,
  allowed: boolean,
): Promise<{ success: boolean }> {
  const response = await fetch(getApiUrl(`workspace-access/${workspaceId}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pageSlug, allowed }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** All members of a workspace (id, name, email, image, role). */
export async function getWorkspaceMembersList(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const response = await fetch(getApiUrl(`workspace/${workspaceId}/members`), {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
