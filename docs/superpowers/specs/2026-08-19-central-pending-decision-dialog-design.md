# Central Pending-Decision Dialog — Design

**Date:** 2026-08-19
**Status:** Approved for planning

## Problem

Assigned work that needs a person's decision is announced but never
demanded. Today a letter routed to someone raises a toast, a chime, and a
dot in the sidebar. All three are passive: the toast disappears, the chime
is heard once, and the dot can sit lit for days. Nothing puts the decision
in front of the person and asks for it.

Correspondence is also the only module with a decision to make. Work-order
assignment (`apps/api/src/asset-registry/index.ts:638`) fires a
notification and nothing else. Project tasks assign by setting a user's
email — no pending state, no acceptance, no rejection. Any surface built
only for letters would have to be rebuilt the first time another module
needs the same thing.

## Goal

A single dialog, shared by every module, that presents work awaiting a
user's decision and takes accept or reject on each item. Correspondence is
the first and, at first, only provider.

## Approach

A **provider registry**: each module implements one interface and
registers it. A single endpoint fans out across the registry and returns
one normalized list. Truth stays in each module's own tables.

Two alternatives were rejected:

- **A shared `pending_decision` table** that modules write into. One fast
  query, but it is a mirror that can drift. `letter_assignment` already
  supersedes rows when routing moves a letter on; every such path would
  have to remember to clear the mirror or the dialog would present
  decisions that no longer exist. In a system with a hash-chained audit
  log, a record that can diverge from the record is the wrong debt.
- **Frontend-only aggregation**, merging each module's existing endpoint
  in React. Zero backend work, but "generic" would mean a switch statement
  in a component, and every new module would edit it.

## Backend

New module at `apps/api/src/pending-decision/`.

### `types.ts`

```ts
export type PendingDecisionItem = {
  source: string;        // "correspondence"
  id: string;            // opaque to the client; the provider decodes it
  title: string;         // "MAPIM/2026/0114"
  subtitle: string;      // the letter subject
  context: string[];     // ["From: Hafiz", "Action: For your action"]
  href: string;          // where "Open" navigates
  createdAt: Date;       // serialized as an ISO string over the wire
  requiresReason: boolean;
};

export type PendingDecisionProvider = {
  source: string;
  list(userId: string, workspaceId: string): Promise<PendingDecisionItem[]>;
  decide(args: {
    userId: string;
    workspaceId: string;
    id: string;
    decision: "accepted" | "rejected";
    reason: string | null;
  }): Promise<void>;
};
```

### `registry.ts`

A plain array of providers. Adding a module is one push.

### `index.ts`

- `GET /pending-decision?workspaceId=` — fans out over the registry,
  flattens, sorts oldest-first. Returns `{ items, failedSources }`.
- `POST /pending-decision/:source/:id/decide` — resolves the provider by
  `source`, 404s if unknown, delegates. Body: `{ workspaceId, decision,
  reason }`.

Both routes carry `describeRoute` and Valibot validators, and sit behind
the workspace-access middleware the correspondence routes already use:
`workspaceAccess.fromQuery("workspaceId")` on the GET and
`workspaceAccess.fromBody("workspaceId")` on the POST.

### Partial failure

The fan-out uses `Promise.allSettled`. Successful providers' items are
returned; a rejected provider is logged server-side and its `source` name
appears in `failedSources`. A queue that quietly under-reports is worse
than one that admits it is incomplete.

### The refactor this forces

`decideAssignment` (`apps/api/src/correspondence/letters.ts:210`) reads its
arguments off the Hono context — `c.req.param()`, `c.get("workspaceId")`,
`c.get("userId")`. A provider cannot call it.

Extract a plain-argument core:

```ts
decideLetterAssignment(args: {
  workspaceId: string;
  userId: string;
  letterId: string;
  assignmentId: string;
  decision: AssignmentDecision;
  reason: string | null;
}): Promise<void>
```

Both existing routes (`/letters/:id/assignments/:aid/accept` and
`/reject`) and the new provider call it. The routes keep their paths,
their bodies, and their behaviour exactly.

The proof that the extraction is clean is that
`tests/api-integration/correspondence-handover.test.ts` passes untouched.

### The correspondence provider

`list` is the `pendingAssignments` query from `letters.ts:403`, lifted out
whole. This includes the `SEALED_LETTER_STATUSES` guard, which is what
stops the dialog presenting an item the user cannot clear.

`id` encodes `letterId:assignmentId`, since the decision needs both.

`requiresReason` is `true`: rejecting correspondence always carries a
written reason into the audit trail. Accepting is one click. This tightens
today's behaviour, where the reject note is optional.

## Frontend

One component, `apps/web/src/components/pending-decision-dialog.tsx`,
mounted in `apps/web/src/routes/_layout/_authenticated.tsx` beside
`<AppAlerts />` — workspace-agnostic, reading the active workspace itself.

### Shape

A single Radix dialog whose body is the list. One item reads as a focused
card: title, subject, sender, requested action, an **Open** link, and
**Accept** / **Reject**. Several items and the same list grows, capped
with `max-h` and scrolled. There is no separate expanded mode to build or
test.

Each card decides independently and disappears when decided. When the last
one goes, the dialog closes.

### When it opens

1. A new pending item arrives **and the user is idle** — no other dialog
   open, and focus is not in an input, textarea, or contenteditable.
2. The user **navigates to Home** and anything is pending. This is what
   makes the feature trustworthy: the dot can never be the only thing
   between someone and a letter.
3. The user clicks the sidebar dot.

Esc and the close button always dismiss. The dot stays lit, and Home
brings the dialog back.

### The chime

The dialog is silent. Assignment already produces a notification, so
`AppAlerts` already toasts and chimes for it; a second sound from the
dialog would mean two chimes for one event. The central alert surface
keeps sole ownership of the audio.

The rule this sets for future providers: a module that creates pending
work must also emit its notification — already the convention throughout
this codebase.

The toast is briefly redundant with a dialog about to open. This is
accepted: it is transient, it names the item, and de-duplicating it would
mean correlating notification rows to pending items.

### Rejecting

The card flips in place to a reason field. Confirm stays disabled until
the trimmed text is non-empty. Cancel flips back. No nested dialog.

### Races

`decideAssignment` guards twice, and both guards are already tested:

- the `status = 'pending'` predicate inside the transaction returns **409
  "This assignment was already decided"** when a competing decision landed
- the sealed-record check returns **409** when the letter was archived or
  disposed meanwhile

The dialog's rule is **409 means gone, not broken**. The card is removed
with a quiet inline line — "Already handled by someone else" — and the
list refetches. No error toast; nothing went wrong. Every other status is
a genuine failure: normal error toast, card left in place to retry.

### Cache invalidation

After any decision, invalidate `["pending-decisions", workspaceId]`, the
existing `["awaiting-acceptance", workspaceId]`, and the my-correspondence
key. Otherwise the dialog empties while the sidebar dot stays lit and the
Home card still lists the letter — three surfaces disagreeing about one
fact.

Add `["pending-decisions"]` to the websocket invalidation in
`apps/web/src/hooks/use-user-websocket.ts:61`, which already refreshes
`["awaiting-acceptance"]` on the same event.

## Testing

**API unit** (`tests/api/pending-decision/`): fan-out merges and sorts
oldest-first; `allSettled` returns healthy providers' items plus the
failed source names when one throws; an unknown `:source` 404s; the
correspondence id round-trips `letterId:assignmentId`.

**API integration**: `correspondence-handover.test.ts` passes untouched.
New cases: the generic `GET` lists a pending letter; `POST .../decide`
accepts it; a second decide on the same row returns 409.

**Web unit**: the dialog opens on a new item while idle and does not while
focus sits in a textarea; it opens on navigating to Home with work
pending; Reject stays disabled until the reason is non-empty; a 409
removes the card with no error toast; the dialog never calls
`chime.play`.

**Browser verification.** The previous branch shipped a sidebar bell that
nobody had seen render. This one is checked in a real browser before it is
called done: assign a letter, confirm the dialog pops, reject it, confirm
the reason is enforced and the dot clears. Automated tests cannot say
whether a modal looks right or traps focus.

## Out of scope

- Acceptance semantics for project tasks or work orders. The registry is
  built so that adding them later is one provider each, but neither has a
  pending state today and neither gains one here.
- Deferring or snoozing an item. Dismissing the dialog is the only defer,
  and Home brings it back.
- Bulk accept. Each item is read and decided on its own.
