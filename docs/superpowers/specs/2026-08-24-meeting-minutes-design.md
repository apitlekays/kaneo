# Meeting Minutes (Organisation-Level) — Design

**Date:** 2026-08-24
**Status:** Approved for planning

## Problem

The organisation holds meetings that belong to nobody's project and no
letter: the AGM, four committee meetings a year, the occasional EGM. Today
they are recorded outside the system entirely. What is lost is not the prose
— that survives in a document somewhere — but the **accountability**: who was
asked to do what, whether they accepted, and whether it was done before the
next meeting asked again.

## The three kinds of "minutes"

This is the single most important thing for anyone building here. Three
unrelated features share the word:

| End-user name | Tables | Scope |
|---|---|---|
| **Meeting Minutes** | `meeting_*` — this spec | Organisation-level meetings |
| **Project Minutes** | `task_mom` | One meeting attached to one task in one project |
| **Letter Minutes** | `letter_minute`, `letter_minute_update` | Annotations and delegated actions on one letter |

They are **separate domains with separate storage**, deliberately. They
converge only on the shared central surfaces — notifications, the alert bell,
and the pending-decision dialog — so a user sees one unified Home no matter
which module generated the work.

**The existing two are never renamed.** `task_mom` and `letter_minute` are
live, migrated and deployed. New organisation tables take the `meeting_`
prefix so a grep for a table name can never return two modules. In UI copy,
always use the full two-word name — "Meeting Minutes", never bare "Minutes"
— anywhere the three could be confused.

## What already exists and is reused

Nothing here is invented that the codebase already solves.

- **The pending-decision registry** (`apps/api/src/pending-decision/`).
  `PendingDecisionProvider` is `{ source, list, decide }` and the dialog
  renders whatever a provider returns with no module-specific knowledge — the
  `badges` field exists precisely so a module can add emphasis without the
  dialog learning its vocabulary. Three providers are registered today
  (`correspondence`, `task`, `minute-action`); meeting actions become the
  fourth.
- **Notifications** key on an open `resourceType` string (`asset`, `branch`,
  `driver`, `issue`, `letter`, `task`, `workspace`). Meetings add `meeting`.
- **`registerConfigResource`** in `apps/api/src/correspondence/index.ts`
  gives any config list CRUD, soft-deactivate, Valibot validation, the
  tamper-evident audit trail, and admin-only writes — from one `ConfigResource`
  descriptor. Meeting types use it rather than growing a bespoke admin screen.
- **The acceptance pattern**, twice proven: a pure decision-rule module with
  unit tests, a transaction whose UPDATE is predicated on the row still being
  `pending` so a lost race claims nothing and returns 409, and a rejection
  that always carries a written reason.
- **`assertGmAdmin`** (`apps/api/src/correspondence/roles.ts`) maps to
  `isGlobalAdmin`, and `requireWorkspacePageAccess("general-management")` is
  the page gate. Global admins bypass the page matrix entirely.

## Decisions taken during design

- **A body is optional per meeting.** Quorum is only meaningful when one is
  attached; standalone meetings do not record it.
- **Action items are their own type**, not project tasks. Governance stays
  complete even when no project fits, at the cost of a second assignment
  surface — which the pending-decision registry already absorbs.
- **Actions require acceptance**, consistent with the other two modules.
- **Attendees may be non-users.** External auditors, guests and members
  without accounts are recorded by name. Only linked users can be assigned
  actions.
- **Adoption is draft → adopted**, recording which later meeting adopted the
  minutes.
- **Confidentiality is per-meeting**, enforced server-side.

## 1. Domain model

Five tables, all CUID2 keys with `createdAt`/`updatedAt` per repo convention,
all workspace-scoped, all foreign keys declaring cascade behaviour.

### `meeting_body`

A standing body: the general assembly, a named committee. Holds `workspaceId`,
`name`, `description`, `quorumRule` (nullable text — e.g. "half plus one";
free text because encoding every constitution's arithmetic is out of scope),
and `isActive` for soft-deactivate.

### `meeting_body_member`

`bodyId`, `userId` (nullable — an external member has no account), `name`
(nullable, used when `userId` is null), `role` (`chair | secretary | member`),
`isActive`. Membership is what makes quorum computable.

**A member row must have exactly one of `userId` or `name`.** Enforce it in
the create path, not only by convention.

### `meeting`

`workspaceId`, `title`, `meetingTypeId` (FK to the config resource below),
`bodyId` (**nullable** — standalone meetings), `scheduledAt`, `location`,
`confidential` (boolean, default false), `status` (`draft | adopted`),
`adoptedAt`, `adoptedByMeetingId` (nullable self-FK — the later meeting that
adopted these minutes), `createdBy`.

`adoptedByMeetingId` is a self-reference and must be `onDelete: "set null"`:
deleting a later meeting must not cascade away an earlier meeting's adoption.

### `meeting_attendee`

`meetingId`, `userId` (nullable), `name` (nullable), `attendance`
(`present | apology | absent`). Same one-of-two rule as body members.

Absentees are recorded, not merely omitted — "who was not there" is a fact
minutes are expected to carry, and `task_mom` already models it that way.

### `meeting_minute_item`

`meetingId`, `position` (integer, for ordering), `agenda`, `discussion`,
`decision`. The narrative rows.

### `meeting_action`

`meetingId`, `minuteItemId` (nullable — an action may arise outside any single
agenda item), `assigneeId` (FK user — actions go only to linked users),
`fromUserId` (who recorded it), `description`, `dueAt`,
`acceptance` (`pending | accepted | rejected`), `rejectionReason`,
`status` (`open | done | cancelled`), `completedAt`, `completedBy`.

Two separate axes, deliberately, exactly as `letter_minute` learned to model
them: **acceptance** is whether the work is yours; **status** is whether it is
finished. Accepting is not doing, and an action must not be completable before
it is accepted.

## 2. Meeting types as a config resource

Meeting types (AGM, committee, EGM, …) are a `ConfigResource` registered
through `registerConfigResource`, giving them list/create/update/deactivate,
Valibot schemas, audit events and admin-only writes for free.

Consequences that follow from what already exists, and are correct here:
reads are available to any General Management page holder (a type's *name* is
reference data the meeting UI needs), writes require `assertGmAdmin`.

## 3. Access rules

Two independent gates. Both server-side; hiding UI is never the boundary.

1. **The page gate.** Every meeting route requires
   `requireWorkspacePageAccess("general-management")`.
2. **The confidentiality gate.** A meeting with `confidential = false` is
   readable by anyone past gate 1. A meeting with `confidential = true` is
   readable only by its attendees (by `userId`) plus global admins.

Write it as a **pure function** — `canReadMeeting({ confidential,
attendeeUserIds, userId, isGlobalAdmin })` — with its own unit tests, then
compose it in routes with the real lookups. The last access-control change in
this codebase shipped two Critical bugs because the boundary was reasoned
about rather than tested; this one gets a testable rule from the start.

**Confidentiality must also gate the derived surfaces**, not just the detail
route: a confidential meeting's actions must not leak its title into a
pending-decision card or a notification for someone who may not read it. The
provider's `list` filters on the same rule.

## 4. Acceptance and the unified Home

`meeting_action` is surfaced by a fourth provider, `source: "meeting-action"`:

- **`list`** returns `pending` actions assigned to the user, in meetings they
  may read. Note the deliberate difference from the correspondence provider,
  which excludes sealed letters: there is no sealed state here, and an action
  from a meeting still in `draft` is real work its assignee should see — the
  minutes being unadopted does not make the task hypothetical.
  `requiresReason: true`, matching the other three.
- **`decide`** loads the action scoped to the workspace, refuses anyone who is
  not the assignee (403), refuses a second decision (409), and guards its
  UPDATE with `acceptance = 'pending'` as the predicate so a lost race claims
  nothing and returns 409 rather than a silent success.
- On **reject**: clear `assigneeId`, store the reason, notify `fromUserId`,
  and leave the action in the meeting's record showing it was assigned and
  declined. Minutes are a historical record; nothing is deleted from them.
- On **accept**: the action stands, and `status` remains `open`.

Notifications use `resourceType: "meeting"` and link to the meeting.

**Completion requires acceptance.** A `pending` action cannot be marked done —
the same 409 guard the correspondence module needed when it turned out an
assignee could complete an action they had never accepted.

## 5. Adoption

A meeting is `draft` until adopted. Adoption sets `status = 'adopted'`,
`adoptedAt`, and `adoptedByMeetingId` — recording the later meeting at which
adoption happened, which is how minutes are actually adopted.

Who may adopt: a global admin, or the body's `chair` or `secretary` when the
meeting has a body. Standalone meetings, having no body, need a global admin.

**Adopted minutes become read-only.** Editing items or attendees after
adoption must be refused; a correction is a matter for the next meeting, which
is what the adoption chain exists to record. Actions remain mutable — accepting
and completing them is exactly the work adoption sets in motion.

## Migration

One additive migration creating the five tables plus the meeting-type config
table. No backfill: nothing exists to grandfather.

## Testing

**Unit (pure):** `canReadMeeting`; the action decision rules (who may decide,
what accept and reject produce, what a second decision does); the adoption
authority rule.

**API integration:**
- A GM page holder who is not an attendee gets 403 on a confidential meeting
  and 200 on a normal one; a global admin gets 200 on both.
- A confidential meeting's action does **not** appear in a non-attendee's
  `GET /pending-decision`, and its title does not leak into any payload they
  can fetch.
- Accept, reject-with-reason, empty reason → 400 before any write, second
  decision → 409, lost race → 409 not silent success.
- A `pending` action cannot be completed.
- Adoption by a chair succeeds, by an unrelated member is refused, and an
  adopted meeting refuses edits to its items.
- A meeting with no body records no quorum and still works end to end — the
  standalone path is the one most likely to be forgotten.

**Web:** the Minutes Manager tab lists meetings; a confidential meeting a user
may not read is absent, not shown-and-locked.

## Out of scope

- **Proxies and vote counting.** Real AGMs need them; they are a larger
  feature than minute-taking and would drag ballots, thresholds and tie-breaks
  into a first release.
- Encoding quorum arithmetic. `quorumRule` is free text a human reads.
- Recurring-meeting scheduling. A committee meeting four times a year is four
  meetings someone creates.
- Converting a meeting action into a project task. The two assignment systems
  stay separate; if this is wanted later it is one field and one endpoint.
- Rich-text or document export of minutes.
- Any change to `task_mom` or `letter_minute`.
