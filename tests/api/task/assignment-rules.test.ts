import { describe, expect, it } from "vitest";
import {
  assertCanDecideTask,
  taskAssigneeAfterDecision,
} from "../../../apps/api/src/task/assignment-rules";

describe("assertCanDecideTask", () => {
  it("lets the recipient decide", () => {
    expect(() =>
      assertCanDecideTask({ toUserId: "u1", status: "pending" }, "u1"),
    ).not.toThrow();
  });

  it("refuses anyone else, including the assigner", () => {
    expect(() =>
      assertCanDecideTask({ toUserId: "u1", status: "pending" }, "boss"),
    ).toThrow();
  });

  it("refuses a decision on an assignment already decided", () => {
    for (const status of ["accepted", "rejected", "superseded"]) {
      expect(() =>
        assertCanDecideTask({ toUserId: "u1", status }, "u1"),
      ).toThrow();
    }
  });
});

describe("taskAssigneeAfterDecision", () => {
  it("makes the recipient the assignee on accept, regardless of any prior incumbent", () => {
    expect(taskAssigneeAfterDecision("accepted", "u1", null)).toBe("u1");
    expect(taskAssigneeAfterDecision("accepted", "u1", "incumbent")).toBe("u1");
  });

  it("leaves an incumbent's assignment in place on reject", () => {
    // The incumbent declined nothing -- rejecting an offer made to someone
    // else must not clear the task out from under them.
    expect(taskAssigneeAfterDecision("rejected", "u1", "incumbent")).toBe(
      "incumbent",
    );
  });

  it("leaves an unassigned task unassigned on reject", () => {
    // Deliberately NOT the assigner: a lead routing twenty tasks should not
    // collect the declined ones on their own board.
    expect(taskAssigneeAfterDecision("rejected", "u1", null)).toBeNull();
  });
});
