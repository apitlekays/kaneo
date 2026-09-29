# Multiple assignees per task — design

**Date:** 2026-09-29. **Status:** approved 2026-09-29; built. See
"Changes made during implementation" at the end.
**Module:** project tasks (`task`, `task_assignment`). Not Meeting Minutes,
not Letter Minutes — their actions keep their own single `assignee_id`.

## Requirement

A task (and a subtask, which is an ordinary task linked by a `subtask`
relation) can be assigned to several people. Their avatars render as a
stack. Everything that follows from being assigned today — Home "My tasks",
notifications, the pending-decision dialog, filters — follows for every
assignee.

## Decisions (answered 2026-09-29)

1. **Each person decides.** Adding someone offers the task to them through
   the existing 2.8.0 flow; they accept or reject independently. A rejection
   affects only that person.
2. **One lead plus others.** Exactly one accepted assignee is the lead; the
   rest are collaborators.
3. **Tasks and subtasks.** Both get the multi-assignee picker and the stack.

## Current state (verified)

- One assignee: `task.assignee_id` (`taskTable.userId`), FK cascade.
- Offers: `task_assignment` rows, `pending|accepted|rejected|superseded`,
  with a partial unique index `task_assignment_one_pending_idx` on `task_id`
  — **one pending offer per task** (migration `0058`).
- `writeTaskAssignment` (`task/assignment-write.ts`) supersedes every pending
  row on each change; `create-task.ts` inserts its offer directly.
- Accept/reject: `pending-decision/providers/task.ts`; on accept it
  overwrites `task.assignee_id`.
- About 20 API files and 35 web files read the single scalar.

## Design

### Data model

**Keep `task.assignee_id` and make it mean "the lead".** Everything that
only ever needs one person keeps working unchanged: Google Calendar sync
(the event lives on the lead's calendar), CSV export's Assignee column,
GitHub/Gitea status events, MCP `list_tasks`/`update_task`, public project
pages, and — importantly — a rolled-back pre-3.4 image.

**New table `task_assignee`** — every *accepted* person on the task,
lead included:

| column | |
|---|---|
| `id` | CUID2 PK |
| `task_id` | FK → task, cascade |
| `user_id` | FK → user, cascade (matches `task.assignee_id`) |
| `is_lead` | boolean, not null, default false |
| `created_at`, `updated_at` | standard |

- unique `(task_id, user_id)`
- partial unique `(task_id) WHERE is_lead` — at most one lead
- index on `user_id` (My tasks, filters)

**Invariant, enforced in one write module:** `task.assignee_id` equals the
`user_id` of the `is_lead` row, or is null when the task has no accepted
assignee. No route writes either side directly.

**Backfill:** one `task_assignee` row with `is_lead = true` for every task
whose `assignee_id` is not null.

**`task_assignment` index change:** drop `task_assignment_one_pending_idx`,
add unique `(task_id, to_user_id) WHERE status = 'pending'` — one live
offer *per person* per task.

### Who is the lead

- The lead is always an **accepted** assignee. Pending people are never lead.
- The first person to be on the task (self-assignment, or first to accept)
  becomes lead automatically.
- A project manager can **Make lead** on any accepted assignee.
- If the lead is removed, the earliest-accepted remaining assignee becomes
  lead; if none remain the task is unassigned (`assignee_id` null).

### Writes

`assignment-write.ts` grows from "set the assignee" to three operations,
each in a transaction that keeps the invariant:

- **add(taskId, userId)** — self → insert `task_assignee` (lead if none) and
  an `accepted` assignment row, as today. Other → insert a `pending`
  assignment row for that person only. Already on the task or already
  pending → no-op. Other people's pending offers are **not** superseded.
- **remove(taskId, userId)** — delete their `task_assignee` row and
  supersede their pending offer; reassign lead if needed.
- **setLead(taskId, userId)** — must already be accepted.

Accept (`providers/task.ts`) inserts the accepter into `task_assignee`
(lead if the task has none) instead of overwriting `assignee_id`. Reject
changes nothing on the task.

**Existing single-value routes keep their contract** so nothing outside
the web app breaks: `PUT /task/assignee/:id { userId }`, the full `PUT`,
import, and MCP still mean *make this person the only assignee*
(remove everyone else, add them). New routes carry the multi operations:
`POST /task/:id/assignees`, `DELETE /task/:id/assignees/:userId`,
`PUT /task/:id/lead`. Create accepts `userIds[]` alongside `userId`.
Bulk "assign" becomes **add** (it no longer replaces); bulk "unassign"
removes everyone.

### Reads

Task payloads keep `userId`/`assigneeName`/`assigneeImage` (the lead) and
gain:

- `assignees: { userId, name, image, isLead }[]` — lead first
- `pendingAssignees: { userId, name }[]` — replaces the scalar
  `pendingAssigneeName` (kept for one release, derived from the first
  entry, then removed)

These are fetched as a second grouped query per page, not a join — the
current left join to pending rows would multiply task rows once a task can
have several.

### What follows every assignee

| Surface | Today | After |
|---|---|---|
| Home "My tasks" | `assignee_id = me` | exists in `task_assignee` for me |
| Assignee filter (board, list, backlog, API `assigneeId`) | matches the one assignee | matches any assignee |
| Pending-decision dialog | one offer per task | one per person; each sees their own |
| Status-change, comment, time-entry notifications | to the assignee | to every accepted assignee except the actor |
| Due-date reminders | one per task to the assignee | claimed once per task and window, as today, and sent to every assignee |
| Google Calendar | assignee's calendar | lead's calendar only |
| Export (JSON) | `userId` | `userId` (lead) + new `assigneeIds[]` (all, lead first) |
| Import | one assignee | unchanged — `userId` becomes an exclusive offer |
| Public project page | assignee name, and (leaked) pending name | accepted people; offers are stripped |

Notification recipients are resolved from `task_assignee` inside the
notification handlers, so GitHub/Gitea and every other event source pick
this up without changes of their own.

### UI

- **`AvatarStack`** — new shared component, extracted from the pattern in
  `components/board/project-members-bar.tsx`: overlapping `ColoredAvatar`s,
  lead first with a ring, at most 3 then `+N`, tooltip per person, pending
  people after as `PendingAssigneeBadge`s. Used on the kanban card, list
  row, backlog row, subtask row, relations, gantt and the properties
  sidebar.
- **Assignee popover** (`task-assignee-popover.tsx`,
  `subtask-assignee-popover.tsx`, card context menu) becomes multi-select
  with checkmarks, pending state per person, and a "Make lead" action.
- **Create-task modal** takes several people.
- The backlog route's own single-string assignee filter is moved onto the
  shared filter hook.

## Migration and release

One drizzle migration (`0065`): create `task_assignee` + backfill a lead
row per assigned task, add `task_assignment.exclusive` (existing pending
offers backfilled to `true`), swap the pending index to one per person.

**Rollback:** the old image keeps working on `task.assignee_id`, which the
new code maintains, so it sees each task's lead. Two caveats: tasks with
several pending offers would show duplicate rows in the old list query, and
the old image ignores collaborators. Clearing surplus pending offers
before rolling back fixes the first. No column is renamed or dropped.

**Version:** proposed **3.4.0 (minor)** — a new capability, additive
tables, existing single-assignee workflows unchanged, no operator step.

## Tests

- API integration: add/remove/lead invariants; two people offered at once
  deciding independently; reject leaves others intact; lead removal hands
  over; My tasks for a collaborator; assignee filter; notifications to all
  assignees minus actor; per-assignee reminder dedupe; legacy single-value
  routes still replace; subtask via relation.
- Web: `AvatarStack` (order, overflow, pending), multi-select popover,
  filter hook matching any assignee.
- Existing `task-acceptance`, `task-assignment-paths`, `pending-decision`
  and `task-relations` suites must keep passing; the one-pending-per-task
  assertions are updated to one-per-person.

## Out of scope

- Project Minutes (MoM) action rows still tag one person.
- Meeting/Letter Minutes actions.
- MCP multi-assignee tools (MCP keeps lead semantics).

## Pre-existing issues found while mapping (not fixed by this spec)

Reported for a decision; each is small and separate.

1. **Offers are silent.** No notification, email or live refresh reaches the
   person offered a task — they find out only when the pending dialog next
   refetches. Worse once several people are offered at once.
2. **Assigner never told of an acceptance.** They are told when an offer
   is declined, not when it is taken up. (First written up as "the accepter
   gets the wrong notification" — on inspection that is deliberate: it is
   the accepter's Home activity-feed entry, with careful handling for
   grandfathered rows, and is left as is.)
3. **Weak guards on two assign paths.** Bulk update and full `PUT` don't
   require project manager or project membership, unlike
   `PUT /task/assignee/:id`. Import also skips the membership check.
4. **Public project pages expose `pendingAssigneeName`** in the API payload
   (not rendered).
5. **Deleting a user deletes their tasks** — `task.assignee_id` is
   `onDelete: cascade`.
6. `project-minutes.tsx` converts a row to a subtask without checking the
   tagged person is a project member, so it can 400.

## Changes made during implementation

- **Issues 1 and 2 fixed**, as separate commits after the feature:
  `task_offered` to each offeree (plus a live refresh of their pending
  dialog), and `task_accepted` to the assigner.

- **`task_assignment.exclusive`.** Keeping the single-value routes' old
  meaning ("make this person the assignee") needs the accept step to know
  whether an offer replaces or adds. Exclusive offers come from the assignee
  PUT, full PUT and import; accepting one makes the accepter the only
  person on the task. Offers from the new add route, create's `userIds`
  and bulk assign are non-exclusive.
- **Reminder table unchanged.** Claiming the reminder once per task and
  sending it to everyone on the task needs no schema change and keeps the
  old image's `ON CONFLICT (task_id, reminder_type)` valid on rollback.
- **Pre-existing issue 4 fixed as a side effect.** The public project
  payload now strips `pendingAssignees` and `pendingAssigneeName`;
  exposing a list of offers would otherwise have widened that leak.
