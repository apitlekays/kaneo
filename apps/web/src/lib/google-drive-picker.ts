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

function getAccessToken(clientId: string): Promise<string> {
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
    // "" = silent if already granted; GIS shows consent only when needed.
    tokenClient.requestAccessToken({ prompt: "" });
  });
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

  const myDrive = new picker.DocsView(picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(picker.DocsViewMode.GRID)
    .setEnableDrives(true);

  const sharedWithMe = new picker.DocsView(picker.ViewId.DOCS)
    .setOwnedByMe(false)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false);

  return new Promise<PickedFile[]>((resolve) => {
    const instance = new picker.PickerBuilder()
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
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
