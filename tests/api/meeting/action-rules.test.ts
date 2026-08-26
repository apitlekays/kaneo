import { describe, expect, it } from "vitest";
import {
  actionAfterDecision,
  assertCanDecideAction,
  canAdoptMeeting,
} from "../../../apps/api/src/meeting/action-rules";

describe("assertCanDecideAction", () => {
  it("lets the assignee decide a pending action", () => {
    expect(() =>
      assertCanDecideAction({ assigneeId: "u1", acceptance: "pending" }, "u1"),
    ).not.toThrow();
  });

  it("refuses anyone who is not the assignee", () => {
    expect(() =>
      assertCanDecideAction({ assigneeId: "u1", acceptance: "pending" }, "u2"),
    ).toThrow();
  });

  it("refuses an action with no assignee", () => {
    expect(() =>
      assertCanDecideAction({ assigneeId: null, acceptance: "pending" }, "u1"),
    ).toThrow();
  });

  it("refuses a second decision", () => {
    for (const acceptance of ["accepted", "rejected"]) {
      expect(() =>
        assertCanDecideAction({ assigneeId: "u1", acceptance }, "u1"),
      ).toThrow();
    }
  });
});

describe("actionAfterDecision", () => {
  it("keeps the assignee on accept", () => {
    expect(actionAfterDecision("accepted", "u1")).toEqual({
      assigneeId: "u1",
      acceptance: "accepted",
    });
  });

  it("clears the assignee on reject", () => {
    // The action stays in the meeting's record showing it was assigned and
    // declined. Minutes are a historical record; nothing is deleted.
    expect(actionAfterDecision("rejected", "u1")).toEqual({
      assigneeId: null,
      acceptance: "rejected",
    });
  });
});

describe("canAdoptMeeting", () => {
  it("lets a global admin adopt", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: true, bodyRole: null })).toBe(true);
  });

  it("lets the chair adopt", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: false, bodyRole: "chair" })).toBe(
      true,
    );
  });

  it("lets the secretary adopt", () => {
    expect(
      canAdoptMeeting({ isGlobalAdmin: false, bodyRole: "secretary" }),
    ).toBe(true);
  });

  it("refuses an ordinary member", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: false, bodyRole: "member" })).toBe(
      false,
    );
  });

  it("refuses a non-admin on a standalone meeting, which has no body role", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: false, bodyRole: null })).toBe(
      false,
    );
  });
});
