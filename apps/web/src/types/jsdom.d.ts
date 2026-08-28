// `jsdom` ships no type declarations of its own (no `types` field, no bundled
// `.d.ts`), and `@types/jsdom` isn't installed. This project only uses it in
// `src/test/setup.ts` to construct a throwaway `window` and read its
// `localStorage`/`sessionStorage` back off — a minimal ambient declaration
// covering exactly that shape, rather than a blanket `declare module "jsdom"`
// that would type the whole import as `any`.
//
// If `@types/jsdom` is ever installed, this file's module declaration will
// collide with it (duplicate `declare module "jsdom"`) — delete this file
// at that point rather than reconciling the two.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    window: Window & typeof globalThis;
  }
}
