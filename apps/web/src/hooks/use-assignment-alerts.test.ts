import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { newAssignmentIds, useAssignmentAlerts } from "./use-assignment-alerts";

describe("newAssignmentIds", () => {
  it("reports an assignment the user has not seen", () => {
    expect(
      newAssignmentIds(new Set(["a"]), [{ id: "a" }, { id: "b" }]),
    ).toEqual(["b"]);
  });

  it("reports nothing when everything is already seen", () => {
    // A refetch or socket reconnect must not replay old alerts.
    expect(
      newAssignmentIds(new Set(["a", "b"]), [{ id: "a" }, { id: "b" }]),
    ).toEqual([]);
  });

  it("reports nothing for an empty list", () => {
    expect(newAssignmentIds(new Set(), [])).toEqual([]);
  });
});

describe("useAssignmentAlerts", () => {
  it("stays silent on the first list, however long it is", () => {
    const onNew = vi.fn();
    const pending = [{ id: "a" }, { id: "b" }, { id: "c" }];

    renderHook(() => useAssignmentAlerts(pending, onNew));

    expect(onNew).not.toHaveBeenCalled();
  });

  it("announces only the assignment added after the first list", () => {
    const onNew = vi.fn();
    const { rerender } = renderHook(
      ({ pending }) => useAssignmentAlerts(pending, onNew),
      {
        initialProps: { pending: [{ id: "a" }] },
      },
    );

    expect(onNew).not.toHaveBeenCalled();

    rerender({ pending: [{ id: "a" }, { id: "b" }] });

    expect(onNew).toHaveBeenCalledOnce();
    expect(onNew).toHaveBeenCalledWith({ id: "b" });
  });

  it("stays silent while the query is still loading, then seeds on the first real list", () => {
    const onNew = vi.fn();
    const { rerender } = renderHook(
      ({ pending }) => useAssignmentAlerts(pending, onNew),
      {
        initialProps: { pending: undefined },
      },
    );

    expect(onNew).not.toHaveBeenCalled();

    rerender({ pending: undefined });

    expect(onNew).not.toHaveBeenCalled();

    rerender({ pending: [{ id: "a" }, { id: "b" }] });

    expect(onNew).not.toHaveBeenCalled();
  });
});
