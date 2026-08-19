import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const chime = vi.hoisted(() => ({ play: vi.fn(), unlock: vi.fn() }));

vi.mock("@/lib/play-chime", () => ({ createChime: () => chime }));

const notifications = vi.hoisted(() => ({
  current: undefined as
    | { id: string; title: string | null; type: string }[]
    | undefined,
}));

vi.mock("@/hooks/queries/notification/use-get-notifications", () => ({
  default: () => ({ data: notifications.current }),
}));

import { AppAlerts } from "./app-alerts";

describe("AppAlerts", () => {
  afterEach(() => {
    cleanup();
    chime.unlock.mockClear();
    chime.play.mockClear();
    notifications.current = undefined;
  });

  it("unlocks audio on the first user interaction, once", () => {
    // Without a gesture the browser swallows the session's first chime.
    render(<AppAlerts />);
    expect(chime.unlock).not.toHaveBeenCalled();

    fireEvent.pointerDown(window);
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: "a" });

    expect(chime.unlock).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the first real list arrives after loading", () => {
    // The seen-set seeds from the FIRST non-undefined list. If anyone gives
    // that list a `?? []` default, the seed is empty and every notification
    // already in the user's history announces itself on page load.
    notifications.current = undefined;
    const { rerender } = render(<AppAlerts />);

    notifications.current = [
      { id: "n1", title: "Existing one", type: "info" },
      { id: "n2", title: "Existing two", type: "info" },
    ];
    rerender(<AppAlerts />);

    expect(chime.play).not.toHaveBeenCalled();
  });
});
