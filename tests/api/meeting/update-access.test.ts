import { describe, expect, it } from "vitest";
import { canPostActionUpdate } from "../../../apps/api/src/meeting/update-access";

describe("canPostActionUpdate", () => {
  it("lets the assignee post", () => {
    expect(
      canPostActionUpdate({
        userId: "u1",
        hasPageAccess: false,
        actionAssigneeId: "u1",
      }),
    ).toBe(true);
  });

  it("lets a page holder post on an action assigned to someone else", () => {
    expect(
      canPostActionUpdate({
        userId: "officer",
        hasPageAccess: true,
        actionAssigneeId: "u1",
      }),
    ).toBe(true);
  });

  it("refuses an unrelated member with no page access", () => {
    expect(
      canPostActionUpdate({
        userId: "stranger",
        hasPageAccess: false,
        actionAssigneeId: "u1",
      }),
    ).toBe(false);
  });

  it("refuses anyone without page access on an unassigned action, even a null-id caller", () => {
    // An imported action can have no assignee. A null actionAssigneeId must
    // never match a caller — even in a hypothetical code path where the
    // caller's own id was somehow null — so this is a strict inequality,
    // not just an "unset" check.
    expect(
      canPostActionUpdate({
        userId: "u1",
        hasPageAccess: false,
        actionAssigneeId: null,
      }),
    ).toBe(false);
  });

  it("lets a page holder post on an unassigned action", () => {
    expect(
      canPostActionUpdate({
        userId: "officer",
        hasPageAccess: true,
        actionAssigneeId: null,
      }),
    ).toBe(true);
  });
});
