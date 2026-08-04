import { JSDOM } from "jsdom";
import "@testing-library/jest-dom/vitest";

// Node 24+ ships its own `localStorage`/`sessionStorage` globals that stay
// undefined unless the process is started with `--localstorage-file`. Because
// those globals already exist, Vitest's jsdom environment skips copying
// jsdom's working implementations over them, so `window.localStorage` reads
// back as undefined and any test touching storage throws. Restore the real
// jsdom-backed Storage objects when that shadowing happened.
if (!globalThis.localStorage || !globalThis.sessionStorage) {
  const { window: storageWindow } = new JSDOM("", {
    url: "http://localhost:3000/",
  });
  for (const key of ["localStorage", "sessionStorage"] as const) {
    if (globalThis[key]) continue;
    Object.defineProperty(globalThis, key, {
      value: storageWindow[key],
      configurable: true,
      writable: true,
    });
  }
}
