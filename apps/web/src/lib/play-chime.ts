type ChimeAudio = { play: () => Promise<void> };

/**
 * Browsers suppress audio until the user has interacted with the page, so a
 * rejected play is expected and must never surface as an error.
 */
export function createChime(options: {
  isMuted: () => boolean;
  audio: ChimeAudio;
}) {
  return {
    play() {
      if (options.isMuted()) return;
      void options.audio.play().catch(() => {});
    },
    unlock() {
      void options.audio.play().catch(() => {});
    },
  };
}
