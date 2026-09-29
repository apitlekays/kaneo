import { describe, expect, it } from "vitest";
import {
  assigneeSummary,
  matchesAssigneeFilter,
  taskPeople,
} from "./task-assignees";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${String(options.name)})` : key;

const shared = {
  userId: "lead",
  assignees: [
    { userId: "lead", name: "Lead", image: null, isLead: true },
    { userId: "other", name: "Other", image: null, isLead: false },
  ],
  pendingAssignees: [{ userId: "offered", name: "Offered" }],
};

describe("taskPeople", () => {
  it("uses the API lists when present", () => {
    const people = taskPeople(shared);
    expect(people.assignees.map((a) => a.userId)).toEqual(["lead", "other"]);
    expect(people.pending.map((p) => p.userId)).toEqual(["offered"]);
  });

  it("falls back to the single-assignee fields for a task without lists", () => {
    const people = taskPeople({
      userId: "u1",
      assigneeName: "Solo",
      pendingAssigneeName: null,
    });
    expect(people.assignees).toEqual([
      { userId: "u1", name: "Solo", image: null, isLead: true },
    ]);
    expect(people.pending).toEqual([]);
  });
});

describe("matchesAssigneeFilter", () => {
  it("matches a collaborator, not only the lead", () => {
    expect(matchesAssigneeFilter(shared, ["other"])).toBe(true);
    expect(matchesAssigneeFilter(shared, ["lead"])).toBe(true);
  });

  it("does not match someone only offered the task", () => {
    expect(matchesAssigneeFilter(shared, ["offered"])).toBe(false);
  });

  it("matches Unassigned only when nobody has accepted", () => {
    expect(matchesAssigneeFilter(shared, [""])).toBe(false);
    expect(matchesAssigneeFilter({ userId: null, assignees: [] }, [""])).toBe(
      true,
    );
  });
});

describe("assigneeSummary", () => {
  it("names the lead and counts everyone else", () => {
    expect(assigneeSummary(taskPeople(shared), t)).toBe("Lead +2");
  });

  it("names the first person offered it when nobody has accepted", () => {
    expect(
      assigneeSummary(
        taskPeople({
          userId: null,
          assignees: [],
          pendingAssignees: [{ userId: "o", name: "Offered" }],
        }),
        t,
      ),
    ).toBe("tasks:popover.assignee.awaiting(Offered)");
  });

  it("reads Unassigned for nobody", () => {
    expect(
      assigneeSummary(taskPeople({ userId: null, assignees: [] }), t),
    ).toBe("tasks:popover.assignee.unassigned");
  });
});
