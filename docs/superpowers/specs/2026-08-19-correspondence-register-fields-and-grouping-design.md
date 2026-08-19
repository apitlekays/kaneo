# Correspondence Register: New Fields, Year Grouping, and Linking — Design

**Date:** 2026-08-19
**Status:** Approved for planning

## Problem

The correspondence register is a flat, undifferentiated list. Four things are
missing that the office needs day to day:

1. Letters accumulate with no visual separation by year, so finding a 2025
   letter means scrolling past every 2026 one.
2. The register records no external reference number. Incoming letters
   almost always carry the sender's own reference, and that is what people
   quote when they call about a letter.
3. Nothing records urgency, so an urgent letter looks exactly like a routine
   one in every list and every notification.
4. Nothing records which MAPIM entity a letter belongs to. The group runs
   four companies through one register.

A fifth thing is half-built rather than missing: letters can already be
linked to one another in the database, but the feature is unusable.

## Decisions taken during design

- **Organisation means the internal entity that owns the letter** — the
  addressee for incoming, the sender for outgoing. It is not the external
  counterparty; `letter.senderOrg` and `letter.recipientOrg` already hold
  that as free text.
- **Organisations live in a config table**, not a hard-coded list, so adding
  or retiring a company is an admin action rather than a deploy.
- **Year headings use the date already shown in the Date column**
  (`receivedAt ?? letterDate ?? createdAt`), not the registration date. The
  column you sort is the column you group by.
- **Urgency reaches four surfaces**: the letter detail view, the Home feed,
  the accept/reject dialog, and assignment notifications.
- **ERN is optional.** Historical letters have none, and not every incoming
  letter carries one.
- **Grouping survives sorting.** Toggling the Date header flips both the
  order of the year headings and the order within them; the register never
  collapses to a flat list.

### Why the letter's own date, not the registration date

A letter dated December 2025 but registered in January 2026 appears under
the **2025** heading while its reference number says 2026.

This is the point, not a wart. The office plans to register letters that
predate the current year — backfilling historical correspondence into the
register — and grouping by registration date would pile every one of them
under the year the data-entry happened, which would tell nobody anything.
Grouping by the letter's own date puts each letter in the year it belongs
to regardless of when it was typed in.

## Data model

### Three columns on `letter`

| Column | Type | Notes |
|---|---|---|
| `external_ref_no` | `text` nullable | The ERN. Indexed with `workspace_id` — it becomes a primary lookup key for incoming letters. |
| `urgency` | `text NOT NULL DEFAULT 'normal'` | `urgent \| normal`. The default backfills every existing row, so no code path handles a null urgency. |
| `organisation_id` | `text` nullable, FK to `gm_organisation`, `ON DELETE SET NULL` | Nullable because historical letters predate it. |

### New table `gm_organisation`

Shaped exactly like `gm_category` (`schema.ts:1804`): `id`, `workspaceId`,
`key`, `label`, `active`, `createdAt`, indexed on `workspaceId`, unique on
`(workspaceId, key)`.

It registers through the existing `registerConfigResource` helper
(`apps/api/src/correspondence/index.ts:207`) at path `organisations`, which
provides list/create/update/delete routes and the audit-log entity type
without new route code, and it appears in the existing settings CRUD screen.

### Migration

Adds the three columns and the table, then seeds four organisations into
every existing workspace:

- MAPIM Malaysia (`mapim-malaysia`)
- UmmahPrima Sdn Bhd (`ummahprima`)
- StageMaster Sdn Bhd (`stagemaster`)
- LadangUmmah Sdn Bhd (`ladangummah`)

New workspaces start empty, consistent with every other GM config table
(none is seeded today).

**Existing letters are backfilled to MAPIM Malaysia.** I initially argued
against this on the grounds that it writes a classification nobody entered
into an audit-logged register; the decision is to backfill, and the
reasoning holds — every letter in the register predates the other three
companies, so MAPIM Malaysia is the accurate answer rather than an invented
one.

The backfill is scoped defensively: it updates only rows where
`organisation_id IS NULL`, so re-running the migration cannot overwrite a
value someone has since set by hand. It is a single bulk `UPDATE` recorded
in the migration file, not per-letter audit events — the hash chain will
show no per-letter attribution for it, and the migration's comment states
plainly what it did and why so anyone auditing the register later finds the
explanation in the history rather than a mystery.

**Organisation stays nullable in the database but is required in the
registration form.** Nullable because the column has to exist before the
backfill runs and because a future workspace may register a letter before
its organisations are configured; required in the form so no new letter
arrives without one.

Changing any of these three fields after registration writes an audit event,
like any other letter edit. Urgency in particular may be escalated later,
and that change must be attributable.

## Registration form

Three fields in `apps/web/src/components/general-management/letter-capture-dialog.tsx`,
following the existing `<Label>` + control pattern:

- **External Reference Number** — text input, placed with the incoming
  fields where it earns its keep, but available for both directions.
- **Urgency** — two-option select, defaults to Normal, never empty.
- **Organisation** — select fed by `useConfigList("organisations", …)`, the
  same hook the Security Label field already uses. Required before submit.

Plus the link picker described under Linking.

## The register list

`apps/web/src/components/general-management/correspondence.tsx`

### Year grouping

Rows group under a heading per calendar year of
`receivedAt ?? letterDate ?? createdAt`. Newest year first, newest letter
first within each year.

### Sorting

Clicking the Date header toggles ascending/descending, flipping both the
order of the year headings and the order within them. Grouping never turns
off.

**Sorting is client-side, deliberately.** The list endpoint
(`letters.ts:488`) returns every matching letter with no pagination, so the
browser already holds the complete set; a server round-trip per click would
cost a refetch and buy nothing.

**If pagination is ever added to this list, this sort silently becomes
"sort the current page."** That is a bug that looks correct until someone
relies on it. The code carries a comment saying so, and sorting must move
server-side the day pagination lands.

### The reference column becomes direction-aware

- **Incoming**: ERN, falling back to `refNo` when there is no ERN, then "—".
  Header reads **ERN**.
- **Outgoing**: `refNo` unchanged. Header reads **Ref No.**

A single header reading "Ref No." above ERN values would misdescribe the
column in a legal register, so the header follows the direction.

The pending-registration tile in the same file also renders `refNo` and
needs the same treatment, or two tables on one screen will disagree about
what a letter is called.

### New columns

- **Urgency** — badge. Urgent renders a badge; Normal renders nothing. A
  grey "Normal" badge on every row would stop the urgent ones standing out.
- **Organisation** — after the counterparty column, truncating.

## Linking

Linking already exists in the data model and the API and is unusable in the
interface. This finishes it.

**What exists:** `letter_link` (`schema.ts:2261`) with
`reply | related | supersedes`; a working POST endpoint
(`letters.ts:1407`); a `linkLetter` fetcher and mutation hook; a "Linked"
tab in the detail dialog.

**What is broken:**

1. The tab renders the raw `toLetterId` — a CUID, meaningless to a reader.
2. Nothing in the interface calls `linkLetter`, so no link can be created.
3. The query reads one direction only (`letters.ts:710`,
   `where fromLetterId = id`). If B is recorded as a reply to A, opening A
   shows nothing — the relationship is invisible from the side that usually
   matters most.

### In registration

A "Responds to / relates to" picker: type to search existing letters by
ERN, Ref No. or subject, choose the relation, attach. Optional and
repeatable.

Search reuses the existing letters list query — which returns every letter
in the workspace unpaginated — and filters client-side. No new endpoint.

**Sequencing constraint.** A link needs both letter ids, and the letter
being registered has none until it is created. So the form holds the chosen
links in local state and posts them *after* the create call returns, against
the new letter's id. Two consequences the implementation must handle:

- If the create succeeds and a link post fails, the letter exists without
  that link. Never roll back a registered record over a link — the
  reference number has already been allocated from a gap-free sequence.
- The dialog must not close until the link posts settle, or a failure
  disappears unseen.

**On failure the dialog stays open and says so**, naming which links failed
and leaving them selected, with a **Retry links** action that re-posts only
the failed ones. The letter is already registered at that point, so the
dialog makes that explicit — "Letter registered as MAPIM/2026/0114. 2 of 3
links could not be saved." — rather than looking like the whole
registration failed.

The registrant can also close the dialog and add the links later: the
detail view's Linked tab carries the same picker, so a failed link is never
a dead end.

### In the detail view

Each link shows the counterpart's reference, subject and direction, and
clicks through to it.

The query becomes **bidirectional**. A letter shows both what it links to
and what links back to it, labelled differently — "Reply to X" against
"Replied to by Y" — because in a correspondence register the direction of a
reply is its meaning.

### In the list

Threading in place — indenting a reply under the letter it answers —
**conflicts with year grouping**. A 2026 reply to a 2025 letter cannot sit
inside both the 2025 group and its own. So the thread lives in a dialog
instead of restructuring the register.

**The icon.** Any letter with at least one link, in either direction,
carries a clickable thread icon in a narrow column. Letters with no links
carry nothing.

This requires the list query to know which letters have links. The query
already computes `actionsDone` / `actionsTotal` per letter with a
correlated subquery (`letters.ts` list route); the link count follows the
same shape. Without it the client would need one request per row to decide
whether to draw an icon.

**The dialog.** Clicking the icon opens a dialog showing the whole thread:
the most recent letter at the top, down to the first correspondence,
ordered by date received (descending). The letter the reader clicked from
is highlighted so they do not lose their place. Each entry shows reference,
subject, direction and date, and clicking one opens that letter.

**The thread is computed server-side**, at a new endpoint
`GET /letters/:id/thread?workspaceId=`.

It walks `letter_link` transitively in **both** directions from the seed
letter, so any letter in a chain returns the same complete thread no matter
which one you open it from. Three constraints the traversal must honour:

- **A visited set.** The links form a graph, not a tree — two letters can
  reference each other, and a cycle would otherwise loop forever.
- **A hard cap of 100 letters**, returned with a flag when the thread is
  truncated. A pathological or accidental web of links must not turn one
  click into an unbounded query.
- **Workspace scoping on every hop.** The traversal joins through
  `letter.workspace_id` at each step, so a link that somehow points across
  workspaces cannot leak a letter the reader may not see.

Results are ordered by `receivedAt ?? letterDate ?? createdAt` descending —
the same date the register groups and sorts by, so the thread and the
register agree about when a letter happened.

## Urgency across the four surfaces

**Letter detail view** and **Home feed** render letter records already: a
badge component and a field.

**The accept/reject dialog** shows generic `PendingDecisionItem`s whose only
free-form space is `context: string[]`. Urgency placed there renders as the
plain text "Urgency: urgent" — no badge, indistinguishable from the routing
instruction beside it. So the contract gains an optional field:

```ts
badges?: { label: string; tone: "urgent" | "info" }[];
```

This keeps the dialog free of correspondence-specific knowledge, and the
next provider with a priority concept inherits it. The correspondence
provider populates it — `[{ label: "Urgent", tone: "urgent" }]` when the
letter is urgent, and an empty array or omitted field otherwise, so a
normal letter renders no badge.

**Notifications and toasts are text-only.** Urgency becomes a prefix —
"Urgent: MAPIM/2026/0114 routed to you" — built in
`apps/web/src/lib/notification-copy.ts`, which already centralises this copy
for both the bell and the toast, so one change covers both.

## Testing

**Unit (pure functions):** year grouping and sort-toggle logic; the
direction-aware reference resolution (incoming with ERN, incoming without,
outgoing); the urgency-to-badge mapping.

**Component:** the register renders year headings in the right order; the
Date header toggles both group order and row order; the link picker
attaches a link.

**API:** the new config resource; the three columns surviving a
create-then-read round-trip; the bidirectional link query returning both
sides.

**Integration:** the migration's seed lands in existing workspaces.

The migration needs care in review: it adds a `NOT NULL` column with a
default to a table holding production records, and inserts seed rows per
workspace.

## Out of scope

- Pagination for the register list, and the server-side sorting it would
  require.
- Inline threaded display in the register rows. The thread dialog replaces
  it; the register keeps one structure, by year.
- Restructuring the free-text `senderOrg` / `recipientOrg` fields.
- Per-letter audit events for the organisation backfill. It is one bulk
  `UPDATE` documented in the migration.
