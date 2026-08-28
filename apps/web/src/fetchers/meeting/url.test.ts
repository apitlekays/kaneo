import { afterEach, describe, expect, it, vi } from "vitest";
import { addAttendee, createMeeting, listMeetings } from "./index";

/**
 * Guards the URLs these fetchers actually request.
 *
 * `createMeeting` and `listMeetings` hit the collection endpoint, so they
 * pass an empty path and a bare query string respectively. A naive
 * `meeting/${path}` join turns both into `/api/meeting/` — and Hono routes
 * strictly, so that 404s while `/api/meeting` succeeds. That shipped: the
 * create dialog failed with a 404 toast, and the list failure was invisible
 * because an errored query renders the same empty state as no meetings.
 *
 * Every integration test calls `/api/meeting` directly, so none of them
 * could catch it. This is the seam where the client's URL is decided.
 */
function stubFetch() {
  // Typed with fetch's own parameters (even though the stub body ignores
  // them) so `spy.mock.calls[0]` carries the actual call arguments instead
  // of inferring an empty tuple from a zero-arg stub.
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("[]", { status: 200 }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function requestedPath(spy: ReturnType<typeof stubFetch>) {
  return new URL(String(spy.mock.calls[0]?.[0])).pathname;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("meeting fetcher URLs", () => {
  it("creates against the collection with no trailing slash", async () => {
    const spy = stubFetch();
    await createMeeting("ws-1", { title: "Q3 Committee" });
    expect(requestedPath(spy)).toBe("/api/meeting");
  });

  it("lists against the collection with no trailing slash", async () => {
    const spy = stubFetch();
    await listMeetings("ws-1");
    expect(requestedPath(spy)).toBe("/api/meeting");
    expect(String(spy.mock.calls[0]?.[0])).toContain("workspaceId=ws-1");
  });

  it("still joins a real path segment", async () => {
    const spy = stubFetch();
    await addAttendee("ws-1", "m-1", { name: "External auditor" });
    expect(requestedPath(spy)).toBe("/api/meeting/m-1/attendees");
  });
});
