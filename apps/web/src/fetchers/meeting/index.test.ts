import { afterEach, describe, expect, it, vi } from "vitest";
import { createMeeting, listMeetings } from "./index";

/**
 * Guards `jsonOrThrow`'s error-message formatting (the `formatErrorMessage`
 * seam) — see audit-a-contract.md finding 1.
 *
 * Two very different bodies can reach a failed response: a hand-thrown
 * `HTTPException(400, { message })`, whose body is a plain-text message, and
 * a Valibot `validator("json"/"query", …)` middleware rejection, whose body
 * is a JSON blob serializing the *entire issue tree*. Before this fix,
 * `jsonOrThrow` threw `new Error(await response.text())` unconditionally, so
 * the second shape landed in a toast as a raw wall of JSON. Every mutation's
 * `onError` in `use-meeting-mutations.ts` feeds `error.message` straight to
 * `toast.error`, so this is the one seam to fix for all of them at once.
 */
function stubFetch(makeResponse: () => Response) {
  const spy = vi.fn(async () => makeResponse());
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("meeting fetcher error messages", () => {
  it("passes a hand-thrown HTTPException's plain-text message through untouched", async () => {
    stubFetch(() => new Response("Title required", { status: 400 }));

    await expect(createMeeting("ws-1", { title: "" })).rejects.toThrow(
      "Title required",
    );
  });

  it("reduces a Valibot validator-rejection's JSON issue tree to its first issue's message, not the raw blob", async () => {
    const body = JSON.stringify({
      data: { workspaceId: "ws-1" },
      error: [
        {
          kind: "schema",
          type: "object",
          expected: '"title"',
          received: "undefined",
          message: 'Invalid key: Expected "title" but received undefined',
        },
      ],
      success: false,
    });
    stubFetch(() => new Response(body, { status: 400 }));

    const message = await listMeetings("ws-1").catch((e: Error) => e.message);

    expect(message).toBe(
      'Invalid key: Expected "title" but received undefined',
    );
    // The whole point: the caller never sees the raw JSON tree.
    expect(message).not.toContain('"success":false');
    expect(message).not.toContain('"kind":"schema"');
  });

  it("falls back to a generic, status-coded message when the body is neither shape", async () => {
    stubFetch(() => new Response("", { status: 500 }));

    const message = await listMeetings("ws-1").catch((e: Error) => e.message);

    expect(message).toBe("Request failed (500)");
  });
});
