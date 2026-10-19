import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetsOf,
  checkForUpdate,
  deployedEntry,
  resetUpdateState,
  startUpdateChecks,
  useUpdateReady,
} from "./app-update";

const page = (entry: string) => `<!doctype html><html><head>
  <script type="module" crossorigin src="${entry}"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-AbC1.js">
  <link rel="stylesheet" crossorigin href="/assets/index-Css9.css">
</head><body><div id="root"></div></body></html>`;

function serve(html: string, assetOk = true) {
  const fetchMock = vi.fn(async (url: string) =>
    url === "/"
      ? new Response(html, { status: 200 })
      : new Response("", { status: assetOk ? 200 : 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let stop = () => {};

beforeEach(() => {
  resetUpdateState();
  document.head.innerHTML =
    '<script type="module" src="/assets/index-OLD1.js"></script>';
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

function readyNow() {
  const { result, unmount } = renderHook(() => useUpdateReady());
  const ready = result.current;
  unmount();
  return ready;
}

describe("app update check", () => {
  it("reads the entry chunk and the assets from a page", () => {
    const html = page("/assets/index-NEW2.js");
    expect(deployedEntry(html)).toBe("/assets/index-NEW2.js");
    expect(assetsOf(html)).toEqual([
      "/assets/index-NEW2.js",
      "/assets/vendor-AbC1.js",
      "/assets/index-Css9.css",
    ]);
  });

  it("stays quiet while the deployed build is the running one", async () => {
    serve(page("/assets/index-OLD1.js"));
    await checkForUpdate();
    expect(readyNow()).toBe(false);
  });

  it("downloads a new build first, then announces it", async () => {
    const fetchMock = serve(page("/assets/index-NEW2.js"));
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledWith("/", { cache: "no-store" });
    expect(fetchMock).toHaveBeenCalledWith("/assets/index-NEW2.js");
    expect(fetchMock).toHaveBeenCalledWith("/assets/index-Css9.css");
    expect(readyNow()).toBe(true);
  });

  it("does not announce a build whose files are not all there yet", async () => {
    serve(page("/assets/index-NEW2.js"), false);
    await checkForUpdate();
    expect(readyNow()).toBe(false);
  });

  it("offers the update when a route chunk has gone missing", async () => {
    serve(page("/assets/index-OLD1.js"));
    stop = startUpdateChecks();
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(readyNow()).toBe(true);
  });

  it("does nothing in dev, where there is no hashed entry", async () => {
    document.head.innerHTML =
      '<script type="module" src="/src/main.tsx"></script>';
    const fetchMock = serve(page("/assets/index-NEW2.js"));
    await checkForUpdate();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
