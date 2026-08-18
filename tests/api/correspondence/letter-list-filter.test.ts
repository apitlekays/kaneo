import { describe, expect, it } from "vitest";
import {
  INACTIVE_LETTER_STATUSES,
  letterStatusFilter,
} from "../../../apps/api/src/correspondence/letter-list-filter";

describe("letterStatusFilter", () => {
  it("hides disposed letters from the register by default", () => {
    expect(letterStatusFilter({})).toEqual({
      kind: "excludes",
      status: "disposed",
    });
  });

  it("shows only disposed letters in the disposed view", () => {
    expect(letterStatusFilter({ disposed: true })).toEqual({
      kind: "equals",
      status: "disposed",
    });
  });

  it("honours an explicit status filter in the register", () => {
    expect(letterStatusFilter({ status: "closed" })).toEqual({
      kind: "equals",
      status: "closed",
    });
  });

  it("keeps archived letters listed — a permanent disposition is a record to keep", () => {
    // `permanent` sets status archived, not disposed, so the default filter
    // must not touch it.
    expect(letterStatusFilter({}).status).not.toBe("archived");
  });

  it("lets the disposed view win over a stale status filter", () => {
    expect(letterStatusFilter({ status: "closed", disposed: true })).toEqual({
      kind: "equals",
      status: "disposed",
    });
  });

  it("treats an empty status string as no filter at all", () => {
    expect(letterStatusFilter({ status: "" })).toEqual({
      kind: "excludes",
      status: "disposed",
    });
  });
});

describe("INACTIVE_LETTER_STATUSES", () => {
  it("keeps disposed letters out of a user's active work feed", () => {
    expect(INACTIVE_LETTER_STATUSES).toContain("disposed");
  });

  it("still excludes the statuses the feed already ignored", () => {
    expect(INACTIVE_LETTER_STATUSES).toContain("closed");
    expect(INACTIVE_LETTER_STATUSES).toContain("archived");
  });

  it("does not exclude a letter that is merely awaiting a response", () => {
    expect(INACTIVE_LETTER_STATUSES).not.toContain("awaiting-response");
  });
});
