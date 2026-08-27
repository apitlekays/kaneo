# Minute Item Bulk Import — CSV Template and Auto-Extracted Actions

**Date:** 2026-08-27
**Status:** Approved for planning
**Covers:** requirement 4 of
`2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`
**Spec 2 of 4.** Spec C (action follow-through) depends on the `numbering`
column this introduces.

## Problem

Minute items are entered one at a time. Real minutes arrive as a table of
twenty or more numbered items, often already typed in a spreadsheet, and
some of those rows are follow-up actions. Re-keying them is the work this
removes.

## The CSV contract

Exactly these columns, in this order:

```
numbering, topic, details, status, action
```

- **numbering** — the minute's own numbering, e.g. `2.1.4`, `3.2`. Free text:
  numbering schemes vary and are not ours to validate.
- **topic** — what the item is about.
- **details** — the discussion or note.
- **status** — free text, not an enum. These are Malay governance terms
  ("Selesai", "Dalam tindakan", "Makluman"), they vary by body, and an enum
  would reject a legitimate minute. Trimmed on import.
- **action** — marked with `/` to mean "this row is also an action". Any
  other value, including blank, means it is not. Accept `/` with surrounding
  whitespace; treat anything else as not-an-action rather than guessing.

A **downloadable template** is served from the Minute Items tab, containing
the header row and one illustrative example row. CSV, which Excel opens
natively — a real `.xlsx` writer is a dependency we do not need.

## Schema changes

`meeting_minute_item` gains two nullable columns:

- `numbering text` — nullable, because items created through the existing
  single-item form have none and must keep working.
- `status text` — nullable, same reason. Spec C's memorandum email renders
  this in its one-row table.

### The `agenda` → `topic` rename

Requirement 4 says "topic (renamed from agenda)". **Rename the column**
rather than keeping `agenda` and relabelling only the UI.

The module shipped days ago (migration `0060`) and holds almost no data, so
the rename is cheap now and permanent later. This codebase has just spent
real effort on naming precision — three unrelated features called "minutes" —
and leaving code that says `agenda` while every human says "topic"
reintroduces exactly the ambiguity that work removed.

**The trap:** drizzle sometimes generates `DROP COLUMN` + `ADD COLUMN`
instead of `RENAME COLUMN`, which silently destroys existing data. The
generated SQL must be **read and confirmed to be `ALTER TABLE … RENAME
COLUMN`**. If it is a drop-and-add, stop and report rather than applying it.

## Import behaviour

`POST /meeting/:id/minute-items/import`, body `{ workspaceId, rows }`, where
the client parses the CSV and posts structured rows. Parsing client-side
keeps CSV-dialect handling out of the API and lets the user see a preview
before committing.

- **Requires the same write authority as adding a single item**, which since
  v2.10.3 proves read access first. Bulk import must not become a second,
  weaker door into a confidential meeting.
- **Refused with 409 on an adopted meeting.** Adopted minutes are read-only
  for items.
- **All-or-nothing, in one transaction.** A half-imported minute is worse
  than a rejected one: the user cannot tell which rows landed, and re-running
  duplicates the ones that did.
- **Validation before any write**, returning every problem at once rather
  than failing on the first. A caller fixing twenty rows one round-trip at a
  time will give up.
- **Rejected if any `numbering` in the file already exists on this meeting**,
  with the conflicts listed. This is what makes an accidental double-import
  safe. Rows with blank numbering are exempt from that check, since they
  cannot collide meaningfully.
- `position` follows file order, continuing after any existing items.

## Auto-extracted actions

For each row whose `action` column is `/`, create a `meeting_action` in the
same transaction, linked to the minute item it came from via
`minuteItemId`.

- `description` is the row's **topic**, with details appended when present.
  The action must be readable on its own in the Actions tab, where the parent
  item is not on screen.
- **`assigneeId` is null.** The CSV carries no assignee, and inventing one
  would be wrong. So an imported action arrives **unassigned**.

**The consequence must be stated in the UI, not discovered:** an unassigned
action has nobody to accept it, so it will not appear in anyone's pending
decisions until it is delegated. The Actions tab must make unassigned
imported actions visibly distinct and delegable. Silently creating work that
reaches no one is the same class of failure as this module's earlier silent
states.

`acceptance` therefore stays at its default for an unassigned action; when it
is later delegated, the existing assignment path applies unchanged.

## Response

Return a summary the UI can show plainly: how many items were created, how
many actions were extracted, and — on rejection — every validation error with
its row number. A row number is what makes an error actionable in a
spreadsheet.

## Testing

**Unit (pure):** the row parser and validator — the `/` marker including
whitespace and other values, blank numbering, missing required fields, and
the error list's shape. Extract it as a pure function so this needs no
database.

**API integration:**
- A valid file creates every item in order, and exactly the `/` rows become
  actions linked to their items.
- An action created this way has `assigneeId` null and appears in no one's
  pending decisions.
- One invalid row rejects the **whole** import and writes nothing — the
  all-or-nothing test.
- Re-importing a file whose numbering already exists is rejected and writes
  nothing.
- Import into an **adopted** meeting is 409.
- A caller who cannot read a confidential meeting cannot import into it.

**Migration:** confirm the generated SQL renames rather than drops the
`agenda` column, and that existing rows keep their text.

**Web:** the template downloads with the exact header row; a parsed file
previews before import; validation errors render against their row numbers;
the fetcher's URL is asserted.

## Out of scope

- Writing real `.xlsx`. CSV opens in Excel.
- Editing items in bulk after import, or re-import as an update.
- Importing attendees.
- Assigning actions during import.
