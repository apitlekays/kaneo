import { describe, expect, it } from "vitest";
import {
  assertCanDecideMinute,
  minuteAfterDecision,
} from "../../../apps/api/src/correspondence/minute-decision";

describe("assertCanDecideMinute", () => {
  it("lets the assignee decide a pending action", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "pending" }, "u1"),
    ).not.toThrow();
  });

  it("refuses anyone who is not the assignee", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "pending" }, "u2"),
    ).toThrow();
  });

  it("refuses an action with no assignee", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: null, acceptance: "pending" }, "u1"),
    ).toThrow();
  });

  it("refuses a second decision on an already-accepted action", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "accepted" }, "u1"),
    ).toThrow();
  });

  it("refuses a second decision on an already-rejected action", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "rejected" }, "u1"),
    ).toThrow();
  });
});

describe("minuteAfterDecision", () => {
  it("keeps the assignee on accept", () => {
    expect(minuteAfterDecision("accepted")).toEqual({
      assigneeId: "keep",
      acceptance: "accepted",
    });
  });

  it("clears the assignee on reject", () => {
    // The action returns to nobody. The officer who delegated it is
    // notified; it is not silently handed back to them as their own work.
    expect(minuteAfterDecision("rejected")).toEqual({
      assigneeId: null,
      acceptance: "rejected",
    });
  });
});
