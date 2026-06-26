/**
 * Minimal Google Picker integration for attaching Drive files to a task.
 * Loads the Picker API (gapi) and Google Identity Services (GIS) on demand,
 * obtains an OAuth token with the drive.readonly scope (so the Picker shows the
 * user's whole Drive), and opens the Picker. Returns the selected files'
 * metadata (link only — nothing is copied).
 *
 * The access token is cached in memory and reused until it nears expiry, so the
 * user consents once rather than on every attach.
 */

// biome-ignore lint/suspicious/noExplicitAny: external Google SDK globals are untyped.
type AnyGoogle = any;

declare global {
  interface Window {
    gapi?: AnyGoogle;
    google?: AnyGoogle;
  }
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

let pickerApiReady = false;
let tokenClient: AnyGoogle = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePickerApi(): Promise<void> {
  await loadScript("https://apis.google.com/js/api.js");
  if (pickerApiReady) return;
  await new Promise<void>((resolve) => {
    window.gapi.load("picker", {
      callback: () => {
        pickerApiReady = true;
        resolve();
      },
    });
  });
}

function ensureGis(): Promise<void> {
  return loadScript("https://accounts.google.com/gsi/client");
}

/**
 * Request a Drive access token. `prompt`:
 *  - ""     → silent if already granted, otherwise GIS shows a consent popup.
 *  - "none" → strictly silent; rejects (no popup) if interaction is required.
 * Used by the picker (interactive, "") and by thumbnail loading (silent, "none").
 */
function requestToken(clientId: string, prompt: "" | "none"): Promise<string> {
  // Reuse a still-valid token (60s safety buffer) to avoid re-prompting.
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return Promise.resolve(cachedToken.token);
  }

  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: () => {}, // replaced per-request below
      });
    }
    tokenClient.callback = (response: AnyGoogle) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      cachedToken = {
        token: response.access_token,
        expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
      };
      resolve(response.access_token);
    };
    // Fires when a silent ("none") request can't complete without UI.
    tokenClient.error_callback = (error: AnyGoogle) => {
      reject(new Error(error?.type ?? "drive_token_error"));
    };
    tokenClient.requestAccessToken({ prompt });
  });
}

function getAccessToken(clientId: string): Promise<string> {
  return requestToken(clientId, "");
}

/** True when a non-expired Drive token is cached in memory this session. */
export function hasDriveToken(): boolean {
  return Boolean(cachedToken && cachedToken.expiresAt - Date.now() > 60_000);
}

/**
 * The cached Drive token if one is still valid, else null. Never triggers a
 * request — so reading it can't pop a GIS window. Callers that want to acquire
 * a token interactively must use getDriveAccessToken with a user gesture.
 */
export function getCachedDriveToken(): string | null {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token;
  }
  return null;
}

/**
 * Obtain a Drive access token outside the picker (e.g. to load thumbnails).
 * `silent` (default) never shows UI — it rejects if consent would be needed,
 * so callers can fall back gracefully without surprising the user with a popup.
 */
export async function getDriveAccessToken(
  clientId: string,
  opts: { silent?: boolean } = {},
): Promise<string> {
  await ensureGis();
  return requestToken(clientId, opts.silent === false ? "" : "none");
}

export type PickedFile = {
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  mimeType?: string;
};

export async function pickDriveFiles(opts: {
  clientId: string;
  apiKey: string;
}): Promise<PickedFile[]> {
  await Promise.all([
    ensurePickerApi(),
    loadScript("https://accounts.google.com/gsi/client"),
  ]);

  const token = await getAccessToken(opts.clientId);
  const appId = opts.clientId.split("-")[0]; // Cloud project number.
  const picker = window.google.picker;

  // My Drive (the user's own files). NOTE: do NOT call setEnableDrives(true)
  // here — that turns the view into a Shared Drives (Team Drives) listing,
  // which is empty for users without Team Drives.
  const myDrive = new picker.DocsView(picker.ViewId.DOCS)
    .setOwnedByMe(true)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(picker.DocsViewMode.GRID);

  const sharedWithMe = new picker.DocsView(picker.ViewId.DOCS)
    .setOwnedByMe(false)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false);

  return new Promise<PickedFile[]>((resolve) => {
    const instance = new picker.PickerBuilder()
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setAppId(appId)
      .setOAuthToken(token)
      .setDeveloperKey(opts.apiKey)
      .addView(myDrive)
      .addView(sharedWithMe)
      .addView(picker.ViewId.RECENTLY_PICKED)
      .setCallback((data: AnyGoogle) => {
        if (data.action === picker.Action.PICKED) {
          const docs = (data.docs ?? []) as AnyGoogle[];
          resolve(
            docs.map((doc) => ({
              id: doc.id,
              name: doc.name,
              url: doc.url,
              iconUrl: doc.iconUrl,
              mimeType: doc.mimeType,
            })),
          );
        } else if (data.action === picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();

    instance.setVisible(true);
  });
}
