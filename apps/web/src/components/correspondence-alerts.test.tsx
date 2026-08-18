import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const chime = vi.hoisted(() => ({ play: vi.fn(), unlock: vi.fn() }));

vi.mock("@/lib/play-chime", () => ({ createChime: () => chime }));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useMyCorrespondence: () => ({ data: undefined }),
}));

import { CorrespondenceAlerts } from "./correspondence-alerts";

describe("CorrespondenceAlerts", () => {
  afterEach(() => {
    cleanup();
    chime.unlock.mockClear();
  });

  it("unlocks audio on the first user interaction, once", () => {
    // Without a gesture the browser swallows the session's first chime.
    render(<CorrespondenceAlerts />);
    expect(chime.unlock).not.toHaveBeenCalled();

    fireEvent.pointerDown(window);
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: "a" });

    expect(chime.unlock).toHaveBeenCalledTimes(1);
  });
});
