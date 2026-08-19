/**
 * The dialog interrupts, so it must earn the interruption: it waits until the
 * user is not mid-sentence. The dot stays lit in the meantime, and landing on
 * Home brings the dialog back — nothing is lost by waiting.
 */
export function isIdleForDialog(active: Element | null): boolean {
  if (!active) return true;
  const tag = active.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return false;
  // jsdom does not compute `isContentEditable` from the attribute, so check
  // the attribute directly as a fallback for the test environment.
  if (
    (active as HTMLElement).isContentEditable ||
    active.getAttribute("contenteditable") === "true"
  )
    return false;
  return true;
}

export function shouldAutoOpen(args: {
  hasPending: boolean;
  isIdle: boolean;
  alreadyOpen: boolean;
  dismissed: boolean;
}): boolean {
  const { hasPending, isIdle, alreadyOpen, dismissed } = args;
  return hasPending && isIdle && !alreadyOpen && !dismissed;
}
