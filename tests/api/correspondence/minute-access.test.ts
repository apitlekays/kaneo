import { describe, expect, it } from "vitest";
import { canPostMinuteUpdate } from "../../../apps/api/src/correspondence/minute-access";

describe("canPostMinuteUpdate", () => {
  it("lets the assignee post", () => {
    expect(
      canPostMinuteUpdate({
        userId: "u1",
        hasPageAccess: false,
        minuteAssigneeId: "u1",
      }),
    ).toBe(true);
  });

  it("lets a general-management officer post on someone else's action", () => {
    expect(
      canPostMinuteUpdate({
        userId: "officer",
        hasPageAccess: true,
        minuteAssigneeId: "u1",
      }),
    ).toBe(true);
  });

  it("refuses an unrelated user with no page access", () => {
    expect(
      canPostMinuteUpdate({
        userId: "stranger",
        hasPageAccess: false,
        minuteAssigneeId: "u1",
      }),
    ).toBe(false);
  });

  it("refuses a non-officer on a minute with no assignee", () => {
    // A plain note has no assignee; there is no work being reported on, so
    // only an officer may add to it.
    expect(
      canPostMinuteUpdate({
        userId: "u1",
        hasPageAccess: false,
        minuteAssigneeId: null,
      }),
    ).toBe(false);
  });

  it("lets an officer post on a minute with no assignee", () => {
    expect(
      canPostMinuteUpdate({
        userId: "officer",
        hasPageAccess: true,
        minuteAssigneeId: null,
      }),
    ).toBe(true);
  });
});
