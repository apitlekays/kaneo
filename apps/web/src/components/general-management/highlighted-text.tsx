/**
 * `text` with every case-insensitive occurrence of `term` wrapped in
 * <mark>, so a search excerpt shows where the match sits. Built from plain
 * string slices (never `dangerouslySetInnerHTML`): the excerpt is document
 * content and arrives unescaped.
 */
export function HighlightedText({
  text,
  term,
}: {
  text: string;
  term: string;
}) {
  const needle = term.trim().toLowerCase();
  if (!needle) return <>{text}</>;

  const lower = text.toLowerCase();
  const parts: { text: string; match: boolean; at: number }[] = [];
  let from = 0;
  while (from < text.length) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    if (at > from)
      parts.push({ text: text.slice(from, at), match: false, at: from });
    parts.push({ text: text.slice(at, at + needle.length), match: true, at });
    from = at + needle.length;
  }
  if (from < text.length)
    parts.push({ text: text.slice(from), match: false, at: from });

  return (
    <>
      {parts.map((part) =>
        part.match ? (
          <mark
            key={part.at}
            className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30"
          >
            {part.text}
          </mark>
        ) : (
          <span key={part.at}>{part.text}</span>
        ),
      )}
    </>
  );
}
