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

  it("unlocks inaudibly, then restores the volume", async () => {
    // The unlock happens on the user's first click. It must satisfy the
    // browser's autoplay gesture requirement without anybody hearing it.
    let volumeAtPlay: number | undefined;
    const audio = {
      volume: 1,
      currentTime: 3,
      pause: vi.fn(),
      play: vi.fn(() => {
        volumeAtPlay = audio.volume;
        return Promise.resolve();
      }),
    };

    await createChime({ isMuted: () => false, audio }).unlock();

    expect(volumeAtPlay).toBe(0);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    expect(audio.volume).toBe(1);
  });
});
