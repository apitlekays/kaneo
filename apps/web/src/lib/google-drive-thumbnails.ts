/**
 * Best-effort Drive thumbnail loading for attachments.
 *
 * Drive exposes a `thumbnailLink` (the real content preview for Docs, Sheets,
 * Slides, PDFs, images, …) but for private files it must be fetched with the
 * user's OAuth token and the link expires after a few hours — so it can't be
 * stored. We fetch a fresh one at view time using the Picker's Drive token,
 * pull the image as a blob, and hand back an object URL. Anything that fails
 * (no grant, expired link, CORS) resolves to `null` so the UI falls back to the
 * plain icon — there's never a hard error.
 */

import { getDriveAccessToken } from "./google-drive-picker";

// fileId → object URL (string) or `null` when the file has no usable thumbnail.
// Object URLs are blobs held for the session; revisiting a task reuses them.
const thumbnailCache = new Map<string, string | null>();

const DRIVE_FILE_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

async function fetchThumbnail(
  fileId: string,
  token: string,
  size: number,
): Promise<string | null> {
  const metaResponse = await fetch(
    `${DRIVE_FILE_ENDPOINT}/${encodeURIComponent(
      fileId,
    )}?fields=thumbnailLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaResponse.ok) return null;

  const meta = (await metaResponse.json()) as { thumbnailLink?: string };
  if (!meta.thumbnailLink) return null;

  // Drive thumbnail URLs end with a size token like `=s220`; bump it for a
  // crisper preview when present.
  const link = meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`);

  const imageResponse = await fetch(link, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!imageResponse.ok) return null;

  const blob = await imageResponse.blob();
  return URL.createObjectURL(blob);
}

/**
 * Load thumbnails for the given file ids, invoking `onLoaded` as each resolves
 * (cached entries fire synchronously-ish first). Never throws; if a Drive token
 * can't be obtained silently it simply does nothing and the icons remain.
 */
export async function loadDriveThumbnails(
  clientId: string,
  fileIds: string[],
  onLoaded: (fileId: string, url: string | null) => void,
  size = 400,
): Promise<void> {
  // Serve anything already cached right away.
  const uncached: string[] = [];
  for (const fileId of fileIds) {
    if (thumbnailCache.has(fileId)) {
      onLoaded(fileId, thumbnailCache.get(fileId) ?? null);
    } else {
      uncached.push(fileId);
    }
  }
  if (uncached.length === 0) return;

  let token: string;
  try {
    token = await getDriveAccessToken(clientId, { silent: true });
  } catch {
    return; // No silent token → leave icons in place, no popup.
  }

  await Promise.all(
    uncached.map(async (fileId) => {
      try {
        const url = await fetchThumbnail(fileId, token, size);
        thumbnailCache.set(fileId, url);
        onLoaded(fileId, url);
      } catch {
        thumbnailCache.set(fileId, null);
        onLoaded(fileId, null);
      }
    }),
  );
}
