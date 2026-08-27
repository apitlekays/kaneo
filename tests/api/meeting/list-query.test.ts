import { describe, expect, it } from "vitest";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  escapeLikePattern,
  MAX_LIMIT,
} from "../../../apps/api/src/meeting/list-query";

describe("cursor codec", () => {
  it("round-trips a cursor with a scheduled date", () => {
    const c = {
      scheduledAt: "2026-03-01T12:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "meeting-1",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("round-trips a cursor whose scheduledAt is null", () => {
    const c = {
      scheduledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "meeting-2",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("returns null for garbage rather than throwing", () => {
    expect(decodeCursor("not-base64-at-all!!")).toBeNull();
  });

  it("returns null for valid base64 that is not a cursor", () => {
    expect(
      decodeCursor(Buffer.from('{"nope":1}').toString("base64url")),
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
