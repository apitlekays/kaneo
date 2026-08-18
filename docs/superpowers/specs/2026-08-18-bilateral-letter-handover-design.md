# Bilateral letter handover, assignment alerts, and a pending-items dot

**Date:** 2026-08-18
**Status:** Approved for implementation
**Module:** General Management → Correspondence

## Problem

Routing a letter changes hands unilaterally. `POST /letters/:id/route` sets
`letter.currentAssigneeId` to the recipient the moment the sender clicks, and
registration does the same at `letters.ts:549`. The recipient learns of it only
through a notification they may never open.

`letter_assignment` already carries a `status` column with the values
`pending | accepted | rejected | done`, and every row is written as `pending`.
Nothing ever reads or advances it. The column was designed for an
acknowledgement step nobody built.

Meanwhile a newly assigned user gets no live signal at all: no toast, no sound,
and nothing in the sidebar to say work is waiting.

## Goals

1. No one becomes Main User without agreeing to it.
2. Every letter has a named person responsible, or is visibly waiting for one.
3. A user learns of an assignment the moment it happens.

## Non-goals

- Departmental assignment. `letter_assignment.toDeptId` exists and the route
  endpoint accepts it, but no UI offers it and none will be added here.
- Server-side enforcement of anything already guarded in the client.
- Reworking delegated actions (minutes). They stay unilateral: a minute asks
  for work without transferring the letter.

## Decisions

| Question | Decision |
|---|---|
| Does registration also require acceptance? | Yes. One rule everywhere. |
| Where does a rejected letter go? | Back to the sender, who is notified. |
| Who watches unaccepted letters? | GM officers, via an "Awaiting acceptance" list. They may reassign. |
| How is the chime controlled? | On by default, muted per device in localStorage. |

## State model

No schema change. `letter_assignment.status` is a plain `text` column, so
`superseded` needs no migration, and `currentAssigneeId` already tolerates null —
`letters.ts:380` counts unassigned letters today.

| Event | `letter_assignment` | `currentAssigneeId` | `letter.status` |
|---|---|---|---|
| Register with assignee | new row, `pending` | stays null | `captured` |
| Route to a user | new row, `pending` | unchanged | unchanged |
| Recipient accepts | `accepted`, `decidedAt` set | recipient | `assigned` |
| Recipient rejects | `rejected`, `decidedAt`, note | sender (`fromUserId`) | `assigned` |
| GM reassigns while pending | old row `superseded`, new row `pending` | unchanged | unchanged |

Two lines change in existing code: `letters.ts:549` and `letters.ts:846` stop
writing `currentAssigneeId`. The route handler also supersedes any open pending
row before inserting its own.

## API

| Endpoint | Who | Effect |
|---|---|---|
| `POST /letters/:id/assignments/:aid/accept` | the named recipient | ownership transfers |
| `POST /letters/:id/assignments/:aid/reject` | the named recipient, with a reason | ownership falls back to the sender |
| `GET /letters/awaiting-acceptance` | GM officers | pending assignments in the workspace |

Only the named recipient may accept or reject. A GM officer who wants a
different person routes the letter again: `POST /letters/:id/route` marks any
open `pending` row `superseded` before writing its own, so a recipient never
keeps a stale item after being bypassed.

Both transitions write an audit event (`accept`, `reject`), so the handover
trail is as auditable as the routing that precedes it.

`my-correspondence` gains a `pendingAssignments` array. Home already calls it,
so the dot costs no extra request.

## Notification delivery

The API calls the existing `broadcastToUser(userId, { entity: "letter-assignment" })`
on assignment, accept, and reject. The client refetches and raises a toast for
entries it has not seen.

The socket payload carries only `{ entity }`, and `USER_SYNC` is shared with
invitations. Widening it would change a shape other code depends on, so the
toast text comes from the refetched record instead. The cost is one round-trip;
the gain is that the toast cannot drift from the record.

Three units, each testable alone:

- `play-chime.ts` — unlocks audio on first user interaction, no-ops when muted.
- `use-chime-preference.ts` — localStorage, defaults to on.
- `use-assignment-alerts.ts` — fires on new entries only, seeding seen ids from
  the first load so a refresh or reconnect stays silent.

## The dot

`nav-main.tsx:36` renders a dot on Home when `pendingAssignments` is non-empty.

The dot means "something waits for your decision". Open delegated actions are
excluded on purpose: a busy registrar always has some, so counting them would
pin the dot on and drain it of meaning.

## Migration of existing data

Letters that already hold a `currentAssigneeId` count as accepted. Applying the
new rule retroactively would strip the Main User from every letter in flight.

## Risks

**A GM officer can inherit bounced letters.** At registration `fromUserId` is
the registering officer, so a rejected letter returns to them. Officers may
accumulate letters clerks decline. This follows from the two decisions above and
is accepted.

**Letters can sit unowned.** A pending letter has no Main User, so no ordinary
user can close it. The "Awaiting acceptance" list is the control.

**The chime may not sound.** Browsers suppress audio until the user interacts
with the page. The first notification after a cold load can be silent, and
behaviour varies by browser.

## Testing

Unit tests, following the `status-rules.ts` precedent, cover the accept and
reject transitions, the fallback-to-sender rule, and supersession. Tests for
`use-assignment-alerts` cover the replay case, where this is most likely to
fail. The chime is verified by ear.
