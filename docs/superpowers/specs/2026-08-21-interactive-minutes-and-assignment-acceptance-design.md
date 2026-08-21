# Interactive Minutes and Assignment Acceptance — Design

**Date:** 2026-08-21
**Status:** Approved for planning

## Problem

Three gaps, related but separable.

1. **A delegated minute action is write-once.** Someone is given an action
   and can mark it done, but there is nowhere to report progress, record
   what was tried, or attach the document produced along the way. The
   handling history of a letter stops at "assigned" and resumes at "done".
2. **Only correspondence has bilateral assignment.** A letter routed to
   someone must be accepted or rejected with a reason. A minute action
   delegated to that same person does not.
3. **Project tasks have no assignment lifecycle at all.** A task carries a
   bare `assignee_id`. Nobody is asked, nobody can decline, and there is no
   record of who did the assigning.

## Scope: three subsystems, built in order

These ship independently and in this sequence:

1. **Interactive minutes** — self-contained; no lifecycle changes.
2. **Minute-action accept/reject** — reuses machinery that already exists.
3. **Task accept/reject** — a lifecycle the task module has never had, in
   the module people use every day.

Each is separately useful. Stopping after (2) leaves a coherent system.

## Decisions taken during design

- **A task is not the assignee's until they accept it.** Pending work shows
  as unassigned to everyone else and is excluded from "my tasks".
- **A rejected task becomes unassigned**, and whoever assigned it is
  notified with the reason. It does not land on the assigner's own board.
- **A file attached while updating a minute is part of the letter's
  record**, tagged to the update.
- **Minute updates are append-only and audited.** A correction is a new
  update, not an edit.
- **The assignee and general-management page-holders may post updates.**

## 1. Interactive minutes

### New table `letter_minute_update`

`id`, `minuteId` (FK `letter_minute`, cascade), `authorId` (FK `user`, set
null), `body` (not null), `createdAt`.

**No update or delete route is created for it.** That is how immutability is
enforced — by the absence of a way to do it, not by a rule someone must
remember. Each insert writes `recordAuditEvent` with `entityType: "letter"`,
the letter's id, and action `minute-update`, so the handling history sits in
the same hash chain as capture, routing and disposal.

### Attachments reuse `letter_attachment`

That table already carries presign, finalize, download, PDF-only validation,
size and `sha256`. It gains a nullable `minute_update_id`.

A file uploaded while reporting progress therefore appears in the letter's
Attachments tab **and** inline in the minute thread — one store, one
download path, one audit trail. A document produced while acting on a letter
is part of that letter's file; it must not be reachable only by scrolling a
comment thread.

### Who may post

The minute's `assigneeId`, or any user with `general-management` page
access. Enforced server-side in the route, not by hiding the control.

### Posting an update does not complete the action

Completion stays the existing explicit step
(`POST /letters/:id/minutes/:mid/complete`). "I have made progress" and
"this is finished" are different claims, and only the second should stop the
clock on a delegated action.

## 2. Accept/reject through the existing provider registry

`PendingDecisionProvider` (`apps/api/src/pending-decision/types.ts`) already
defines `list(userId, workspaceId)` and `decide({ userId, workspaceId, id,
decision, reason, ip })`, and the dialog renders whatever any provider
returns with no module-specific knowledge. Both new cases are providers, not
new surfaces:

- `minute-action` — actions delegated to you, awaiting a decision
- `task` — project tasks assigned to you

They inherit the chime, the toast, the sidebar dot, the dialog that opens
when idle or on Home, the mandatory rejection reason, and 409-means-already
-decided. Each is a `list`, a `decide`, and one line in `registry.ts`.

Both set `requiresReason: true` on rejection, matching correspondence.

### Where a minute action's pending state lives

`letter_minute` gains one column: `acceptance`, `text NOT NULL DEFAULT
'accepted'`, holding `pending | accepted | rejected`.

The default does the grandfathering by itself — every existing delegated
action is `accepted` the moment the column exists, with no backfill
statement to get wrong. Newly delegated actions are written explicitly as
`pending`.

No `minute_assignment` table is needed. The minute row already records who
delegated the action: `authorId` is the officer who wrote the minute. That
is the person a rejection notifies.

**Rejecting a minute action** sets `assigneeId` to null, `acceptance` to
`rejected`, stores the reason, and notifies `authorId`. The minute itself
remains in the letter's history — it is part of the record — showing that
the action was delegated and declined, with the reason. It does not vanish.

### Self-assignment is auto-accepted

Assigning work to yourself and then being prompted to accept it is
ceremony with no reader. The notification handlers already carry
`!== userId` guards for the same reason. The assignment row is written
directly as `accepted`.

### Every existing assignment is grandfathered as accepted

Enabling this retroactively would place every currently-assigned task and
every open minute action into someone's pending queue at once — hundreds of
prompts for work already underway. Migration `0053` made exactly this call
for letters. New assignments only.

## 3. Task assignment lifecycle

The largest piece, and the one with no existing analogue in its own module.

### What exists

`taskTable.userId` (column `assignee_id`), and a `task.assignee_changed`
event that notifies. No assignment record, no history, and **no record of
who assigned the task**.

### New table `task_assignment`

Shaped after `letter_assignment`: `id`, `taskId` (FK, cascade),
`fromUserId` (FK user, set null), `toUserId` (FK user, set null),
`status` (`pending | accepted | rejected | superseded`), `reason`,
`createdAt`, `decidedAt`. Indexed on `taskId` and on `toUserId`.

`fromUserId` must be captured at assignment time — it is what makes a
rejection notifiable, and nothing records it today.

### What changes in meaning

`task.assignee_id` becomes **the accepted assignee**, written only when
someone accepts. Consequences, all of which correspondence already solved:

- A task with a pending assignment shows as unassigned on the board.
- "My tasks" excludes it until accepted.
- Reassigning a task with an outstanding pending assignment **supersedes**
  it rather than creating a second live prompt.
- Rejecting sets `assignee_id` to null and notifies `fromUserId`.

### Null assigners are real

Grandfathered rows have `fromUserId = null`, because nobody recorded who
assigned that work and inventing an assigner in a system that will notify
them is worse than admitting we do not know. The rejection path must
tolerate a null assigner — unassign the task and notify nobody, rather than
fail.

## Migration

One migration, additive and safe to re-run:

1. Create `letter_minute_update`.
2. Add nullable `minute_update_id` to `letter_attachment`.
3. Add `acceptance text NOT NULL DEFAULT 'accepted'` to `letter_minute`.
4. Create `task_assignment`.
5. Backfill: for every task with a non-null `assignee_id`, insert an
   `accepted` row with `from_user_id = NULL`, scoped with
   `WHERE NOT EXISTS` against `task_assignment` so a re-run is a no-op.

Minute actions need no backfill statement: step 3's default grandfathers
every existing delegated action as `accepted` the moment the column exists.
Only tasks need step 5, because their acceptance lives in a new table rather
than a defaulted column.

## Testing

**Unit (pure):** the provider row-to-item mappers; the acceptance state
machine (who may decide, what an accept or reject produces, what a decision
on an already-decided assignment does).

**API:** a non-assignee without general-management access is refused when
posting a minute update — that is the rule that matters, and the one a UI
guard alone would not enforce.

**Integration:** assign → pending → the board shows unassigned → accept →
assigned. Assign → reject → unassigned with the assigner notified. Reject
where `fromUserId` is null → unassigned, no crash. Reassign over a pending
assignment → the first is superseded, exactly one prompt exists. The
grandfathering backfill verified across two workspaces, as `0054`'s was —
including that a task already assigned before the migration never appears
in anyone's pending queue.

**The test that matters most:** a task with a pending assignment does not
appear in the assignee's "my tasks". That is the difference between this
feature being real and being decoration.

## Out of scope

- Editing or deleting a minute update. There is deliberately no route.
- Per-project configuration of whether acceptance is required.
- Retrofitting an assigner onto historical task assignments.
- Acceptance for work-order or asset-registry assignments. The registry
  makes each a single provider later.
