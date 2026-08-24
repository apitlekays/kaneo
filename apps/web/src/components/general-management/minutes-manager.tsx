/**
 * Meeting minutes — scaffold only.
 *
 * This is a deliberate stub: the tab and its place in the shell exist, and
 * nothing else does. Meeting minutes are a distinct domain from a letter's
 * `letter_minute` annotations (agendas, attendees, quorum, resolutions,
 * adoption of prior minutes), so they get their own spec and tables rather
 * than being grown here ad hoc.
 *
 * It renders an honest empty state rather than placeholder tables or dead
 * buttons — a stub that looks functional is worse than one that admits it
 * is not.
 */
export function MinutesManager() {
  return (
    <div className="mx-auto max-w-2xl space-y-2 py-12 text-center">
      <h2 className="font-semibold text-lg">Minutes Manager</h2>
      <p className="text-muted-foreground text-sm">
        Meeting minutes are not built yet. This page is a placeholder for the
        module.
      </p>
    </div>
  );
}
