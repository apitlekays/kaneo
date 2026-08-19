import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const chime = vi.hoisted(() => ({ play: vi.fn(), unlock: vi.fn() }));

vi.mock("@/lib/play-chime", () => ({ createChime: () => chime }));

vi.mock("@/hooks/queries/notification/use-get-notifications", () => ({
  default: () => ({ data: undefined }),
}));

import { AppAlerts } from "./app-alerts";

describe("AppAlerts", () => {
  afterEach(() => {
    cleanup();
    chime.unlock.mockClear();
    chime.play.mockClear();
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

  it("stays silent when the notification list is still loading", () => {
    // If a `?? []` default ever creeps in, the seen-set seeds empty and every
    // existing notification announces itself as new the moment data arrives.
    render(<AppAlerts />);
    expect(chime.play).not.toHaveBeenCalled();
  });
});
