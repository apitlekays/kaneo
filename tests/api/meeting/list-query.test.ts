import { describe, expect, it } from "vitest";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  escapeLikePattern,
  MAX_LIMIT,
} from "../../../apps/api/src/meeting/list-query";

/** Build a cursor's wire form without going through `encodeCursor`. */
function raw(cursor: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

describe("cursor codec", () => {
  it("round-trips a cursor with a scheduled date", () => {
    const c = {
      scheduledAt: "2026-03-01 12:00:00",
      createdAt: "2026-01-01 00:00:00",
      id: "meeting-1",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("round-trips a cursor whose scheduledAt is null", () => {
    const c = {
      scheduledAt: null,
      createdAt: "2026-01-01 00:00:00",
      id: "meeting-2",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("round-trips microsecond precision without losing digits", () => {
    // The whole reason the cursor carries Postgres timestamp TEXT rather
    // than an ISO string from a JS Date: `now()` populates these columns to
    // microseconds, a Date holds milliseconds, and a cursor coarser than
    // the ORDER BY makes rows in the truncated interval unreachable on
    // every page. Assert the tail digits survive verbatim.
    const c = {
      scheduledAt: "2026-03-01 12:00:00.654321",
      createdAt: "2026-01-01 00:00:00.123456",
      id: "meeting-micro",
    };
    const back = decodeCursor(encodeCursor(c));
    expect(back).toEqual(c);
    expect(back?.createdAt).toBe("2026-01-01 00:00:00.123456");
    expect(back?.scheduledAt).toBe("2026-03-01 12:00:00.654321");
  });

  it("accepts the shapes Postgres actually renders", () => {
    for (const value of [
      "2026-01-01 00:00:00",
      "2026-01-01 00:00:00.1",
      "2026-01-01 00:00:00.123",
      "2026-01-01 00:00:00.123456",
      "2026-01-01T00:00:00.123456",
    ]) {
      expect(
        decodeCursor(raw({ scheduledAt: null, createdAt: value, id: "m" })),
      ).not.toBeNull();
    }
  });

  it("returns null for garbage rather than throwing", () => {
    expect(decodeCursor("not-base64-at-all!!")).toBeNull();
  });

  it("returns null for valid base64 that is not a cursor", () => {
    expect(
      decodeCursor(Buffer.from('{"nope":1}').toString("base64url")),
    ).toBeNull();
  });

  it("returns null for a structurally valid cursor with a malformed createdAt", () => {
    // A crafted cursor like this must not reach keysetCondition, where it
    // is cast with `::timestamp`: Postgres would raise and the route would
    // answer 500 instead of the 400 it promises for a bad cursor.
    for (const value of [
      "nonsense",
      "2026",
      "2026-01-01",
      "2026-01-01 00:00",
      "2026-01-01 00:00:00.1234567",
      "2026-01-01 00:00:00Z",
      "2026-01-01 00:00:00.123Z",
      "2026-01-01 00:00:00+08",
      " 2026-01-01 00:00:00",
      "2026-01-01 00:00:00'; drop table meeting; --",
    ]) {
      expect(
        decodeCursor(raw({ scheduledAt: null, createdAt: value, id: "m" })),
      ).toBeNull();
    }
  });

  it("returns null for a structurally valid cursor with a malformed scheduledAt", () => {
    expect(
      decodeCursor(
        raw({
          scheduledAt: "also-nonsense",
          createdAt: "2026-01-01 00:00:00",
          id: "meeting-4",
        }),
      ),
    ).toBeNull();
  });
});

describe("escapeLikePattern", () => {
  it("escapes the wildcards a user can type", () => {
    // Without this, searching "100%" matches every meeting, and "a_b"
    // matches "axb" — the search silently over-matches.
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes the escape character first", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("Quarterly Committee")).toBe(
      "Quarterly Committee",
    );
  });
});

describe("clampLimit", () => {
  it("defaults when absent", () => {
    expect(clampLimit(undefined)).toBe(24);
  });

  it("caps a client asking for everything", () => {
    expect(clampLimit("100000")).toBe(MAX_LIMIT);
  });

  it("defaults on nonsense rather than returning NaN", () => {
    expect(clampLimit("abc")).toBe(24);
    expect(clampLimit("0")).toBe(24);
    expect(clampLimit("-5")).toBe(24);
  });

  it("honours a sensible value", () => {
    expect(clampLimit("10")).toBe(10);
  });
});
