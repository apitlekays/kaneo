// Deterministic per-user avatar color + initials, used by ColoredAvatar so the
// same user keeps the same tint everywhere (members table, assignees, comments,
// nav, etc.) without any server-side state. Seed on a stable key — the user id
// where available — so the color is consistent across every surface.

export const AVATAR_TONES = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
] as const;

/** Pick a stable tone from a cheap string hash of `seed`. */
export function getAvatarTone(seed: string | null | undefined): string {
  const value = seed ?? "";
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

/** Up to two uppercase initials from a name; "?" when empty. */
export function getInitials(value: string | null | undefined): string {
  if (!value) return "?";
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
