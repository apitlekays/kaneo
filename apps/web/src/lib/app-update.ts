import { useSyncExternalStore } from "react";

/**
 * Notices a deploy while a tab is open, downloads the new build in the
 * background, and only then says so, so the reload behind "Update" is quick.
 *
 * A build is identified by its entry chunk, `/assets/index-<hash>.js`: Vite
 * changes the hash whenever the code changes, and `index.html` names it. The
 * running tab's entry is read from its own <script> tag; the deployed one
 * from a fresh fetch of `/`. In dev there is no hashed entry, so checks are
 * off.
 */

const CHECK_EVERY_MS = 5 * 60 * 1000;
// Coming back to a tab triggers a check; this stops tab-flicking from
// turning into a request per flick.
const MIN_GAP_MS = 60 * 1000;

const ENTRY = /\/assets\/index-[\w-]+\.js$/;
const ENTRY_IN_HTML = /<script\b[^>]*\bsrc="([^"]*\/assets\/index-[\w-]+\.js)"/;
const STYLES_IN_HTML =
  /<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*\bhref="([^"]+)"/g;

let ready = false;
let lastCheck = 0;
let checking = false;
let prepared: string | null = null;
const listeners = new Set<() => void>();

function announce() {
  if (ready) return;
  ready = true;
  for (const listener of listeners) listener();
}

export function runningEntry(doc: Document = document): string | null {
  for (const script of doc.querySelectorAll<HTMLScriptElement>(
    'script[type="module"][src]',
  )) {
    const path = new URL(script.src, window.location.href).pathname;
    if (ENTRY.test(path)) return path;
  }
  return null;
}

export function deployedEntry(html: string): string | null {
  const src = html.match(ENTRY_IN_HTML)?.[1];
  return src ? new URL(src, window.location.href).pathname : null;
}

/** The entry script plus the stylesheets and preloads the new page needs. */
export function assetsOf(html: string): string[] {
  const entry = html.match(ENTRY_IN_HTML)?.[1];
  const links = [...html.matchAll(STYLES_IN_HTML)].map((m) => m[1] as string);
  return [...new Set([...(entry ? [entry] : []), ...links])];
}

export async function checkForUpdate(): Promise<void> {
  const running = runningEntry();
  if (!running || ready || checking) return;
  if (Date.now() - lastCheck < MIN_GAP_MS) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const deployed = deployedEntry(html);
    if (!deployed || deployed === running) return;
    if (prepared !== deployed) {
      // Warm the HTTP cache. If any of it fails (say the server is
      // mid-restart), say nothing and try again on the next check.
      const responses = await Promise.all(
        assetsOf(html).map((url) => fetch(url)),
      );
      if (responses.some((r) => !r.ok)) return;
      prepared = deployed;
    }
    announce();
  } catch {
    // Offline or mid-deploy: the next check tries again.
  } finally {
    checking = false;
  }
}

/**
 * A lazy route chunk that no longer exists means the build this tab came
 * from has been replaced. Offer the update rather than leave a broken page.
 */
function onPreloadError(event: Event) {
  event.preventDefault();
  announce();
}

let started = false;

export function startUpdateChecks(): () => void {
  if (started || !runningEntry()) return () => {};
  started = true;
  const onVisible = () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  };
  const timer = window.setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  window.addEventListener("vite:preloadError", onPreloadError);
  // A tab restored from a cached page can already be behind.
  void checkForUpdate();
  return () => {
    started = false;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    window.removeEventListener("vite:preloadError", onPreloadError);
  };
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ready,
  );
}

/** Tests only. */
export function resetUpdateState() {
  ready = false;
  lastCheck = 0;
  checking = false;
  prepared = null;
}
