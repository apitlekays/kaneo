import { describe, expect, it } from "vitest";
import { newAssignmentIds } from "./use-assignment-alerts";

describe("newAssignmentIds", () => {
  it("reports an assignment the user has not seen", () => {
    expect(newAssignmentIds(new Set(["a"]), [{ id: "a" }, { id: "b" }])).toEqual(
      ["b"],
    );
  });

  it("reports nothing when everything is already seen", () => {
    // A refetch or socket reconnect must not replay old alerts.
    expect(newAssignmentIds(new Set(["a", "b"]), [{ id: "a" }, { id: "b" }])).toEqual(
      [],
    );
  });

  it("reports nothing for an empty list", () => {
    expect(newAssignmentIds(new Set(), [])).toEqual([]);
  });
});
