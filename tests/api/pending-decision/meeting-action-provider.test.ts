import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/meeting-action";

const row = {
  id: "a1",
  meetingId: "m1",
  meetingTitle: "Q3 Committee Meeting",
  description: "Draft the audit response",
  dueAt: new Date("2026-09-30T00:00:00.000Z"),
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
};

describe("meeting-action toPendingItem", () => {
  it("names the item by the meeting", () => {
    const item = toPendingItem(row, "ws-1");
    expect(item.source).toBe("meeting-action");
    expect(item.title).toBe("Q3 Committee Meeting");
    expect(item.id).toBe("a1");
  });

  it("carries the action so the reader knows what they are accepting", () => {
    expect(toPendingItem(row, "ws-1").subtitle).toContain(
      "Draft the audit response",
    );
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row, "ws-1").requiresReason).toBe(true);
  });

  it("links to a route that exists", () => {
    // A sibling provider shipped an href to a nonexistent route, so every
    // decision in the dialog 404'd. Assert the real shape.
    //
    // Verified against apps/web/src/routes/_layout/_authenticated/dashboard/category/general-management.tsx
    // (routeTree.gen.ts confirms the path is exactly
    // "/dashboard/category/general-management" — the brief's guess was
    // correct; no route rename was needed).
    expect(toPendingItem(row, "ws-1").href).toBe(
      "/dashboard/category/general-management",
    );
  });
});
