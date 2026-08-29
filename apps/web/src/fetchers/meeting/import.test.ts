import { afterEach, describe, expect, it, vi } from "vitest";
import { importMinuteItems } from "./index";

/**
 * Guards the minute-item bulk import fetcher: the URL it hits, the body it
 * sends, and that a 400 carrying `{ errors: [{ row, message }] }` surfaces a
 * readable, row-numbered message rather than the raw JSON — following
 * list.test.ts's fetch-stubbing shape and index.test.ts's error-message
 * coverage for the same `formatErrorMessage` seam.
 */
function stubFetch(response: Response) {
  // Typed with fetch's own parameters (even though the stub body ignores
  // them) so `spy.mock.calls[0]` carries the actual call arguments instead
  // of inferring an empty tuple from a zero-arg stub — same shape as
  // url.test.ts's stub.
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => response,
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importMinuteItems", () => {
  it("posts to the import endpoint with no trailing slash and no double slash", async () => {
    const spy = stubFetch(
      new Response(JSON.stringify({ itemsCreated: 2, actionsCreated: 1 }), {
        status: 201,
      }),
    );

    await importMinuteItems("ws-1", "meeting-1", [
      { topic: "Approve the annual budget" },
    ]);

    const [requestUrl, init] = spy.mock.calls[0];
    const requested = new URL(String(requestUrl));
    expect(requested.pathname).toBe(
      "/api/meeting/meeting-1/minute-items/import",
    );
    expect(requested.pathname).not.toContain("//");

    const body = JSON.parse(String(init?.body));
    expect(body.workspaceId).toBe("ws-1");
    expect(body.rows).toEqual([{ topic: "Approve the annual budget" }]);
  });

  it("returns the created counts", async () => {
    stubFetch(
      new Response(JSON.stringify({ itemsCreated: 3, actionsCreated: 2 }), {
        status: 201,
      }),
    );

    const result = await importMinuteItems("ws-1", "meeting-1", []);
    expect(result).toEqual({ itemsCreated: 3, actionsCreated: 2 });
  });

  it("reduces a 400's { errors: [{ row, message }] } body to a readable, row-numbered message", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          errors: [
            { row: 4, message: "topic is required" },
            { row: 7, message: 'numbering "1.1" is already used on row 3' },
          ],
        }),
        { status: 400 },
      ),
    );

    const message = await importMinuteItems("ws-1", "meeting-1", []).catch(
      (e: Error) => e.message,
    );

    expect(message).toBe("Row 4: topic is required (and 1 more)");
    // The whole point: no raw JSON wall reaches the caller.
    expect(message).not.toContain("{");
  });

  it("doesn't append the '(and N more)' suffix when there's only one error", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ errors: [{ row: 2, message: "topic is required" }] }),
        { status: 400 },
      ),
    );

    const message = await importMinuteItems("ws-1", "meeting-1", []).catch(
      (e: Error) => e.message,
    );

    expect(message).toBe("Row 2: topic is required");
  });

  it("attaches the full row-error list to the thrown Error, not just the first", async () => {
    // The one-line `.message` collapses to the first issue (for a toast),
    // but a caller that wants to show every bad row — the import preview
    // does — needs the whole array, not just what the summary can carry.
    stubFetch(
      new Response(
        JSON.stringify({
          errors: [
            { row: 4, message: "topic is required" },
            { row: 7, message: 'numbering "1.1" is already used on row 3' },
          ],
        }),
        { status: 400 },
      ),
    );

    const error = (await importMinuteItems("ws-1", "meeting-1", []).catch(
      (e) => e,
    )) as Error & { rowErrors?: Array<{ row: number; message: string }> };

    expect(error.rowErrors).toEqual([
      { row: 4, message: "topic is required" },
      { row: 7, message: 'numbering "1.1" is already used on row 3' },
    ]);
  });
});
