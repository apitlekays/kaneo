/** Half-width of the window around the match, in characters. */
const DEFAULT_RADIUS = 90;

/**
 * A short, single-line excerpt around the first occurrence of `term`, so a
 * search result can explain itself. Returns null when the term is absent —
 * the caller omits that document from the hit rather than showing an
 * unexplained match.
 *
 * A snippet is CONTENT. Callers must already have established that the
 * viewer may read the meeting this text came from; see the spec's
 * confidentiality section.
 */
export function buildSnippet(
  text: string,
  term: string,
  radius: number = DEFAULT_RADIUS,
): string | null {
  const needle = term.trim();
  if (!needle) return null;

  // Plain indexOf on lowercased copies: no regex, so metacharacters in the
  // term are literals and there is no catastrophic-backtracking surface on
  // user input. Both strings are lowercased with the same rules, so the
  // index maps back to the original text 1:1 for the alphabets in use.
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;

  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();

  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}
