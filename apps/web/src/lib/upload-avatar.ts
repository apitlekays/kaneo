import { getApiUrl } from "@/fetchers/get-api-url";

const allowedImageMimeTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export function isSupportedAvatarFile(file: File) {
  return allowedImageMimeTypes.has(file.type.toLowerCase());
}

type AvatarUploadTicket = {
  uploadUrl: string;
  key: string;
  headers: Record<string, string>;
  imageUrl: string;
};

/**
 * Upload a new avatar: ask the API for a presigned PUT URL, push the bytes
 * straight to object storage, then return the stable served image URL. The
 * caller is responsible for persisting `imageUrl` on the user (via
 * authClient.updateUser) so it shows up everywhere.
 */
export async function uploadAvatar(file: File): Promise<string> {
  if (!isSupportedAvatarFile(file)) {
    throw new Error("Only image files (PNG, JPG, GIF, WebP) are supported.");
  }
  if (file.size <= 0) {
    throw new Error("The selected file is empty.");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("Image must be 10MB or smaller.");
  }

  const ticketResponse = await fetch(getApiUrl("user/avatar-upload"), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });

  if (!ticketResponse.ok) {
    throw new Error(
      (await ticketResponse.text()) || "Failed to start avatar upload.",
    );
  }

  const ticket = (await ticketResponse.json()) as AvatarUploadTicket;

  const putResponse = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: ticket.headers,
    body: file,
  });

  if (!putResponse.ok) {
    throw new Error("Failed to upload image to storage.");
  }

  return ticket.imageUrl;
}
