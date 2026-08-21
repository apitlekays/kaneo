import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/minute-action";

const row = {
  id: "m1",
  letterId: "l1",
  body: "Draft a reply by Friday",
  actionType: "For your action",
  dueAt: new Date("2026-09-01T00:00:00.000Z"),
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
  refNo: "MAPIM/2026/0114",
  subject: "Permohonan kerjasama",
};

describe("minute-action toPendingItem", () => {
  it("names the item by the letter, not the minute id", () => {
    const item = toPendingItem(row);
    expect(item.source).toBe("minute-action");
    expect(item.title).toBe("MAPIM/2026/0114");
    expect(item.id).toBe("m1");
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row).requiresReason).toBe(true);
  });

  it("carries the action body so the reader knows what they are accepting", () => {
    expect(toPendingItem(row).context.join(" ")).toContain(
      "Draft a reply by Friday",
    );
  });

  it("falls back to the subject when the letter has no reference yet", () => {
    expect(toPendingItem({ ...row, refNo: null }).title).toBe(
      "Permohonan kerjasama",
    );
  });

  it("points the href at the real letter detail route", () => {
    // Must match apps/web/src/routes/.../dashboard/correspondence.$letterId.tsx
    expect(toPendingItem(row).href).toBe("/dashboard/correspondence/l1");
  });
});
