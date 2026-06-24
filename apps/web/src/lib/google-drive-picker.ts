/**
 * Minimal Google Picker integration for attaching Drive files to a task.
 * Loads the Picker API (gapi) and Google Identity Services (GIS) on demand,
 * obtains a short-lived OAuth token with the drive.file scope, and opens the
 * Picker. Returns the selected files' metadata (link only — nothing is copied).
 */

// biome-ignore lint/suspicious/noExplicitAny: external Google SDK globals are untyped.
type AnyGoogle = any;

declare global {
  interface Window {
    gapi?: AnyGoogle;
    google?: AnyGoogle;
  }
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let pickerApiReady = false;

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
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response: AnyGoogle) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.access_token);
        }
      },
    });
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

  return new Promise<PickedFile[]>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const instance = new picker.PickerBuilder()
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setAppId(appId)
      .setOAuthToken(token)
      .setDeveloperKey(opts.apiKey)
      .addView(view)
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
