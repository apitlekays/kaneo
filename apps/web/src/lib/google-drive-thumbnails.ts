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

import {
  getCachedDriveToken,
  getDriveAccessToken,
} from "./google-drive-picker";

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
 * (cached entries fire first). Never throws.
 *
 * By default it uses ONLY a token already cached in memory — it never requests
 * one, so it can't pop a GIS window on task open. Pass `interactive: true` (from
 * a user gesture, e.g. a "Show previews" button) to acquire a token, which may
 * show a Google popup once; the token is then cached for the rest of the
 * session so subsequent loads are silent.
 *
 * Returns true if a usable token was available (cached or freshly granted).
 */
export async function loadDriveThumbnails(
  clientId: string,
  fileIds: string[],
  onLoaded: (fileId: string, url: string | null) => void,
  opts: { interactive?: boolean; size?: number } = {},
): Promise<boolean> {
  const size = opts.size ?? 400;

  // Serve anything already cached right away.
  const uncached: string[] = [];
  for (const fileId of fileIds) {
    if (thumbnailCache.has(fileId)) {
      onLoaded(fileId, thumbnailCache.get(fileId) ?? null);
    } else {
      uncached.push(fileId);
    }
  }
  if (uncached.length === 0) return true;

  let token: string | null;
  if (opts.interactive) {
    try {
      token = await getDriveAccessToken(clientId, { silent: false });
    } catch {
      return false; // User dismissed/denied — leave icons in place.
    }
  } else {
    // No popup ever: only proceed if we already hold a token.
    token = getCachedDriveToken();
    if (!token) return false;
  }

  const resolvedToken = token;
  await Promise.all(
    uncached.map(async (fileId) => {
      try {
        const url = await fetchThumbnail(fileId, resolvedToken, size);
        thumbnailCache.set(fileId, url);
        onLoaded(fileId, url);
      } catch {
        thumbnailCache.set(fileId, null);
        onLoaded(fileId, null);
      }
    }),
  );
  return true;
}
