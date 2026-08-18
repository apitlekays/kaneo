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
  AND l.current_assignee_id = a.to_user_id;
