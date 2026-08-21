import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/task";

const row = {
  id: "a1",
  taskId: "t1",
  title: "Fix the export",
  taskNumber: 42,
  projectName: "Platform",
  projectSlug: "platform",
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("task toPendingItem", () => {
  it("identifies the task, not the assignment row", () => {
    const item = toPendingItem(row);
    expect(item.source).toBe("task");
    expect(item.subtitle).toBe("Fix the export");
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row).requiresReason).toBe(true);
  });

  it("names the project so the reader knows whose work this is", () => {
    expect(toPendingItem(row).context.join(" ")).toContain("Platform");
  });
});
