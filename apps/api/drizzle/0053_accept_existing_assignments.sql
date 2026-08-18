-- Assignments predating bilateral handover: the letter is already owned by the
-- assignee, so the handover plainly happened. Mark them accepted so they do not
-- resurface as pending work.
UPDATE letter_assignment a
SET status = 'accepted',
    decided_at = COALESCE(a.decided_at, a.created_at)
FROM letter l
WHERE a.letter_id = l.id
  AND a.status = 'pending'
  AND l.current_assignee_id IS NOT NULL
  AND l.current_assignee_id = a.to_user_id;--> statement-breakpoint
-- Every OTHER pending row is an earlier hop of a letter that has since moved on:
-- the old code overwrote current_assignee_id on each route without closing the
-- row it replaced. Left pending, those rows resurface as live work — the bypassed
-- recipient could accept and yank ownership from the sitting Main User, forcing
-- status 'assigned' and reopening a closed, archived or disposed record.
-- Terminal statuses are included even when the letter has no owner, because a
-- record that has been closed out must never be reopened by an accept.
-- Idempotent: the rows it matches stop being 'pending', so a second run is a no-op.
UPDATE letter_assignment a
SET status = 'superseded',
    decided_at = COALESCE(a.decided_at, a.created_at)
FROM letter l
WHERE a.letter_id = l.id
  AND a.status = 'pending'
  AND (
    l.current_assignee_id IS NOT NULL
    OR l.status IN ('closed', 'archived', 'disposed')
  );
