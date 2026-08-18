type ChimeAudio = {
  play: () => Promise<void>;
  pause?: () => void;
  volume?: number;
  currentTime?: number;
};

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
    /**
     * Satisfy the browser's "audio needs a user gesture" rule on the first
     * click or keypress. Played at zero volume and rewound immediately: the
     * point is the permission, not the sound.
     */
    unlock() {
      const { audio } = options;
      const previousVolume = audio.volume ?? 1;
      audio.volume = 0;
      return audio
        .play()
        .catch(() => {})
        .finally(() => {
          audio.pause?.();
          audio.currentTime = 0;
          audio.volume = previousVolume;
        });
    },
  };
}
