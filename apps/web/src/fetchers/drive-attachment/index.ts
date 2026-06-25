import { getApiUrl } from "@/fetchers/get-api-url";

export type DriveAttachment = {
  id: string;
  taskId: string;
  userId: string;
  fileId: string;
  name: string;
  url: string;
  iconUrl: string | null;
  mimeType: string | null;
  createdAt: string;
};

export async function getDriveAttachments(
  taskId: string,
): Promise<DriveAttachment[]> {
  const response = await fetch(getApiUrl(`drive-attachment/${taskId}`), {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function addDriveAttachment(
  taskId: string,
  file: {
    fileId: string;
    name: string;
    url: string;
    iconUrl?: string | null;
    mimeType?: string | null;
  },
): Promise<DriveAttachment> {
  const response = await fetch(getApiUrl(`drive-attachment/${taskId}`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(file),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteDriveAttachment(
  id: string,
): Promise<{ success: boolean }> {
  const response = await fetch(getApiUrl(`drive-attachment/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
