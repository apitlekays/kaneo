import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useChimePreference } from "./use-chime-preference";

describe("useChimePreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to audible", () => {
    const { result } = renderHook(() => useChimePreference());
    expect(result.current.muted).toBe(false);
  });

  it("persists the choice for this device", () => {
    const { result } = renderHook(() => useChimePreference());

    act(() => result.current.setMuted(true));

    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem("kaneo.correspondence.chimeMuted")).toBe(
      "true",
    );
  });

  it("shares the choice with every mounted consumer", () => {
    // The toggle lives in the sidebar and the chime plays from a component
    // mounted elsewhere; per-component state would leave the chime unmuted.
    const toggle = renderHook(() => useChimePreference());
    const player = renderHook(() => useChimePreference());

    act(() => toggle.result.current.setMuted(true));

    expect(player.result.current.muted).toBe(true);
  });
});
