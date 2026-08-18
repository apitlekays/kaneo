import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { unseenIds, useUnseenAlerts } from "./use-notification-alerts";

const item = (id: string) => ({ id });

describe("unseenIds", () => {
  it("reports an id the user has not seen", () => {
    expect(unseenIds(new Set(["a"]), [item("a"), item("b")])).toEqual(["b"]);
  });

  it("reports nothing when everything is already seen", () => {
    expect(unseenIds(new Set(["a", "b"]), [item("a"), item("b")])).toEqual([]);
  });
});

describe("useUnseenAlerts", () => {
  it("stays silent on the first list, however long it is", () => {
    const onUnseen = vi.fn();
    renderHook(() =>
      useUnseenAlerts([item("a"), item("b"), item("c")], onUnseen),
    );
    expect(onUnseen).not.toHaveBeenCalled();
  });

  it("stays silent while the query is loading, then seeds on the first real list", () => {
    const onUnseen = vi.fn();
    const { rerender } = renderHook(
      ({ items }) => useUnseenAlerts(items, onUnseen),
      { initialProps: { items: undefined as { id: string }[] | undefined } },
    );
    rerender({ items: undefined });
    rerender({ items: [item("a"), item("b")] });
    expect(onUnseen).not.toHaveBeenCalled();
  });

  it("delivers a burst as ONE call carrying every new item", () => {
    // This is what lets the caller chime once for five notifications.
    const onUnseen = vi.fn();
    const { rerender } = renderHook(
      ({ items }) => useUnseenAlerts(items, onUnseen),
      { initialProps: { items: [item("a")] } },
    );
    rerender({ items: [item("a"), item("b"), item("c"), item("d")] });
    expect(onUnseen).toHaveBeenCalledTimes(1);
    expect(onUnseen.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("announces each item only once across renders", () => {
    const onUnseen = vi.fn();
    const { rerender } = renderHook(
      ({ items }) => useUnseenAlerts(items, onUnseen),
      { initialProps: { items: [item("a")] } },
    );
    rerender({ items: [item("a"), item("b")] });
    rerender({ items: [item("a"), item("b")] });
    expect(onUnseen).toHaveBeenCalledTimes(1);
  });
});
