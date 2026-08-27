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

  it("returns null for a calendar-invalid but shape-valid createdAt", () => {
    // PG_TIMESTAMP is a shape check only: it matches digit grouping, not
    // calendar validity, so a hand-crafted cursor carrying an impossible
    // date/time passes it and would otherwise reach keysetCondition's
    // `::timestamp` cast — Postgres raises a date/time-out-of-range error
    // there, and the route has no try/catch, so it would answer an
    // unhandled 500 instead of the 400 it promises for a bad cursor.
    for (const value of [
      "9999-13-45 99:99:99", // impossible month, day, hour, minute, second all at once
      "2026-13-01 00:00:00", // impossible month
      "2026-01-32 00:00:00", // impossible day
      "2026-02-30 00:00:00", // impossible day for February
      "2027-02-29 00:00:00", // Feb 29 in a non-leap year
      "2026-01-01 24:00:00", // impossible hour
      "2026-01-01 00:60:00", // impossible minute
      "2026-01-01 00:00:60", // impossible second
      "2026-00-01 00:00:00", // month zero
      "2026-01-00 00:00:00", // day zero
      "0000-01-01 00:00:00", // year zero — Postgres has no year 0
    ]) {
      expect(
        decodeCursor(raw({ scheduledAt: null, createdAt: value, id: "m" })),
      ).toBeNull();
    }
  });

  it("returns null for a calendar-invalid scheduledAt", () => {
    expect(
      decodeCursor(
        raw({
          scheduledAt: "2026-02-30 00:00:00",
          createdAt: "2026-01-01 00:00:00",
          id: "meeting-5",
        }),
      ),
    ).toBeNull();
  });

  it("still accepts a legitimate leap day", () => {
    // Over-strict validation that rejects a real timestamp would be a worse
    // bug than the one this fixes — 2028 is a genuine leap year.
    const c = {
      scheduledAt: null,
      createdAt: "2028-02-29 12:00:00",
      id: "meeting-leap",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
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
