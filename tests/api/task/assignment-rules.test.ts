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
  it("makes the recipient the assignee on accept", () => {
    expect(taskAssigneeAfterDecision("accepted", "u1")).toBe("u1");
  });

  it("leaves the task unassigned on reject", () => {
    // Deliberately NOT the assigner: a lead routing twenty tasks should not
    // collect the declined ones on their own board.
    expect(taskAssigneeAfterDecision("rejected", "u1")).toBeNull();
  });
});
