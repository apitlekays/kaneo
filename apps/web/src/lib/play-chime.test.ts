import { describe, expect, it, vi } from "vitest";
import { createChime } from "./play-chime";

function fakeAudio() {
  const play = vi.fn().mockResolvedValue(undefined);
  return { play };
}

describe("createChime", () => {
  it("plays when not muted", () => {
    const audio = fakeAudio();
    createChime({ isMuted: () => false, audio }).play();
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("stays silent when muted", () => {
    const audio = fakeAudio();
    createChime({ isMuted: () => true, audio }).play();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("swallows a rejected play so a blocked autoplay never breaks the caller", async () => {
    const audio = { play: vi.fn().mockRejectedValue(new Error("blocked")) };
    const chime = createChime({ isMuted: () => false, audio });
    expect(() => chime.play()).not.toThrow();
    await Promise.resolve();
  });
});
