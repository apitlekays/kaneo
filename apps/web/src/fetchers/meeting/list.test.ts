import { afterEach, describe, expect, it, vi } from "vitest";
import { listMeetings } from "./index";

/**
 * The URL assertions matter as much as the response ones: a trailing-slash
 * 404 shipped to production because every integration test called the route
 * directly and nothing exercised this construction.
 */
function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listMeetings", () => {
  it("requests the collection endpoint with no trailing slash", async () => {
    const fetchMock = mockFetchOnce({ items: [], nextCursor: null });
    await listMeetings("ws-1");
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain("/meeting?");
    expect(requested).not.toContain("/meeting/?");
    expect(requested).toContain("workspaceId=ws-1");
  });

  it("passes cursor, q and limit through", async () => {
    const fetchMock = mockFetchOnce({ items: [], nextCursor: null });
    await listMeetings("ws-1", {
      cursor: "abc+/=",
      q: "majlis syura",
      limit: 10,
    });
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.searchParams.get("workspaceId")).toBe("ws-1");
    expect(requested.searchParams.get("cursor")).toBe("abc+/=");
    expect(requested.searchParams.get("q")).toBe("majlis syura");
    expect(requested.searchParams.get("limit")).toBe("10");
  });

  it("omits optional params entirely when not given", async () => {
    const fetchMock = mockFetchOnce({ items: [], nextCursor: null });
    await listMeetings("ws-1");
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).not.toContain("cursor=");
    expect(requested).not.toContain("q=");
  });

  it("returns the page as-is", async () => {
    mockFetchOnce({
      items: [
        { id: "m1", title: "AGM", meetingTypeLabel: "AGM", bodyName: null },
      ],
      nextCursor: "next",
    });
    const page = await listMeetings("ws-1");
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("next");
  });
});
