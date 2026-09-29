# Multiple assignees per task — implementation plan

**Spec:** `docs/superpowers/specs/2026-09-29-multi-assignee-tasks-design.md`
(approved 2026-09-29).

**Goal:** several people per task and subtask, one of them the lead, each
accepting their own offer; avatars stacked; My tasks, filters,
notifications and reminders follow every assignee.

**Architecture:** `task.assignee_id` stays and means *the lead*. A new
`task_assignee` table holds every accepted person, lead included. One
module, `task/assignees-write.ts`, is the only writer of either side and
keeps them in agreement. One module, `task/assignees-read.ts`, loads
`assignees[]` / `pendingAssignees[]` for a set of task ids with a second
query, never a join. The legacy single-value routes keep meaning "make this
person the only assignee" — an offer made that way carries
`task_assignment.exclusive = true`, and accepting it replaces everyone else,
exactly as 2.8.0 behaved.

**Verification baseline (2026-09-29, before any change):** API integration
36 files, 304 passed, 1 skipped, against a local `postgres:16-alpine`.

---

## Phase 1 — schema

1. `schema.ts`: `taskAssigneeTable` (`task_assignee`: id, task_id, user_id,
   is_lead, timestamps; unique (task_id, user_id); partial unique (task_id)
   where is_lead; index user_id). `task_assignment.exclusive` boolean not
   null default false. Replace `task_assignment_one_pending_idx` with
   unique (task_id, to_user_id) where pending. `task_reminder_sent.user_id`
   nullable FK; unique key (task_id, reminder_type, user_id).
2. `relations.ts`: task ↔ assignees.
3. `db:generate`, then append the backfill to the generated SQL: one lead
   row per task with a non-null `assignee_id`.

## Phase 2 — write path

4. `task/assignees-write.ts`: `addAssignee`, `removeAssignee`, `setLead`,
   `acceptOffer`, `replaceAssignees` (the legacy single-value semantics),
   and a private `syncLead` that enforces the invariant.
5. `assignment-write.ts`'s `writeTaskAssignment` becomes a thin wrapper
   over `replaceAssignees`, so every existing caller (update-task,
   update-task-assignee, bulk, import) keeps its behaviour.
6. `create-task.ts`: accept `userIds[]`; first self-or-offer semantics per
   person; exclusive=false for multi create, legacy `userId` alone stays
   exclusive.
7. `pending-decision/providers/task.ts`: accept → `acceptOffer`; reject
   changes nothing on the task.
8. New routes in `task/index.ts` (project-manager guard, membership check,
   Valibot): `POST /task/:id/assignees`, `DELETE /task/:id/assignees/:userId`,
   `PUT /task/:id/lead`. Bulk `updateAssignee` → add; clear stays clear.

## Phase 3 — read path

9. `task/assignees-read.ts` + use it in get-tasks, get-task, get-my-tasks,
   get-task-relations, export. Drop the pending left joins.
10. My tasks: `exists` in `task_assignee` for the user. `assigneeId`
    filter: same `exists`.
11. Export: add an `assignees` column (all emails/names, `;`-separated).

## Phase 4 — notifications and reminders

12. `notification/index.ts`: status-changed and comment-created resolve
    recipients from `task_assignee` (all accepted, minus actor).
    `time-entry` likewise.
13. `scheduler/due-date-reminders.ts`: one reminder per task per assignee,
    deduped on (task, type, user).

## Phase 5 — web

14. Types: `assignees`, `pendingAssignees` on `Task`.
15. `components/ui/avatar-stack.tsx` (+ test), extracted from
    `project-members-bar.tsx`.
16. Use it on kanban card, list row, backlog row, subtask row, relations,
    gantt, properties sidebar.
17. Multi-select `task-assignee-popover.tsx` with Make lead / Remove;
    `subtask-assignee-popover.tsx` and the card context menu likewise;
    create-task modal multi.
18. Filters match any assignee; backlog uses the shared matcher.
19. Fetchers/mutations for the three new routes; invalidate `tasks`,
    `task`, `my-tasks`, `pending-decisions`.

## Phase 6 — verify

20. Integration tests (listed in the spec), web tests, `biome ci .`,
    `pnpm typecheck`, full API integration + web suites.

## Phase 7 — separate commits, droppable

21. Notify the offeree when a task is offered (in-app + delivery) and
    refresh their pending-decision query over WS.
22. On accept, notify the assigner "X accepted", not the accepter.
