import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/task";

const row = {
  id: "a1",
  taskId: "t1",
  // Not in the brief's original fixture: href can't point at a real route
  // without the project id, and workspaceId is threaded through as
  // toPendingItem's second argument rather than folded into the row.
  projectId: "p1",
  title: "Fix the export",
  taskNumber: 42,
  projectName: "Platform",
  projectSlug: "platform",
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
};
const workspaceId = "w1";

describe("task toPendingItem", () => {
  it("identifies the task, not the assignment row", () => {
    const item = toPendingItem(row, workspaceId);
    expect(item.source).toBe("task");
    expect(item.subtitle).toBe("Fix the export");
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row, workspaceId).requiresReason).toBe(true);
  });

  it("names the project so the reader knows whose work this is", () => {
    expect(toPendingItem(row, workspaceId).context.join(" ")).toContain(
      "Platform",
    );
  });

  it("links to the real task route, not a 404", () => {
    // Must match apps/web/src/routes/.../dashboard/workspace/$workspaceId/
    // project/$projectId/task/$taskId_.tsx
    expect(toPendingItem(row, workspaceId).href).toBe(
      "/dashboard/workspace/w1/project/p1/task/t1",
    );
  });
});
