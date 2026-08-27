# Meetings Library — Document Cards, Lazy Loading, Omni Search

**Date:** 2026-08-27
**Status:** Approved for planning
**Covers:** requirements 1 and 2 of
`2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`
**Spec 1 of 4.** See that file for the full split and the answers this
argues from.

## Problem

The Meeting Minutes page lists meetings as flat rows. Minutes are documents —
people recognise them as objects, not table entries — and the list has no
search and no pagination, so it does not survive a workspace with a few
hundred meetings.

## What already exists

`GET /meeting` (`apps/api/src/meeting/index.ts:~244`) takes only
`workspaceId`, orders `asc(meetingTable.scheduledAt)`, and returns **every**
meeting. Confidentiality is applied **after** the query, as a JavaScript
`.filter()` over the returned rows using `canReadMeeting`.

`minutes-manager.tsx` renders the result as `<button>` rows and now handles
`isError` distinctly from empty (fixed in v2.10.3).

## The constraint that shapes this whole design

**Post-query filtering and pagination are incompatible.** Fetch 20 rows,
filter 5 out for confidentiality, and you return 15 — a short page that is
not the last page. The client cannot tell "short page" from "end of list",
page sizes wobble, and a cursor taken from the last surviving row silently
skips the filtered ones.

So the confidentiality rule must move **into the query**. A meeting is
visible when:

```
NOT confidential
OR viewer is a global admin
OR EXISTS (attendee row for this meeting with this user_id)
```

That is expressible in SQL directly. `canReadMeeting` stays the single
source of truth for the *rule* and remains the unit-tested pure function used
by the detail route and the pending-decision provider; the list gets a SQL
predicate that must agree with it. **A test must assert the two agree** —
divergence between an in-SQL filter and an in-code rule is exactly the
"gate correct where everyone looks, missing where nobody does" failure this
module has already shipped twice.

## Ordering

Change to **newest first** (`scheduledAt DESC`). A minutes library is read
from the most recent meeting backwards; oldest-first is wrong for a document
list and becomes actively unusable once paginated.

`scheduledAt` is **nullable**, so ordering needs an explicit, total order:

```
ORDER BY scheduled_at DESC NULLS LAST, created_at DESC, id DESC
```

Without a tiebreaker, rows with equal or null `scheduledAt` have no stable
order and a cursor can skip or repeat them.

## Lazy loading

**Cursor pagination, not offset.** Offset pagination double-counts and skips
rows when a meeting is created while the user scrolls, which is likely here
because the create dialog sits on the same page.

- `GET /meeting?workspaceId=…&limit=…&cursor=…&q=…`
- `limit` defaults to 24, capped at 100 — a cap is a server concern; a client
  asking for everything must not be able to.
- The cursor encodes the sort tuple `(scheduledAt, createdAt, id)` of the last
  row returned. Opaque to the client.
- Response becomes `{ items: Meeting[], nextCursor: string | null }`.
  `nextCursor === null` means end of list — the explicit signal that removes
  the short-page ambiguity above.

**This changes the response shape**, so the fetcher's return type and
`useMeetings` change with it. `useMeetings` becomes `useInfiniteQuery`.

## Omni search

- One text input above the grid. Debounced.
- Scope in this spec: **meeting metadata** — title, location, and the meeting
  type's and body's names where set. Case-insensitive substring.
- **Spec D extends the same input to search PDF text.** Design the parameter
  as a single `q` now so that extension needs no client change and no second
  search box.
- Search runs **in the same query** as the visibility predicate and
  pagination. Searching then filtering then paginating in three places
  reintroduces the problem above.
- Searching resets pagination to the first page.

## Document cards

Replace the row list with a responsive grid of document cards. Each card:

- A **portrait rectangle** suggesting a page, so it reads as a document.
- The **title inside the rectangle**, clamped to a fixed number of lines with
  an ellipsis. A long title must never resize its card or overflow it — the
  grid stays even.
- **Metadata beneath the title**: meeting date, type, and the draft/adopted
  state. The confidential marker keeps its current treatment (it has a test).
- The whole card is the click target and must remain a real focusable button.

Use the full name **"Meeting Minutes"**, never bare "Minutes".

## Empty, error, loading, and end-of-list

Four states, all distinguishable — this module shipped a bug where a failed
query rendered as "no meetings" and hid a 404 for days:

- **Loading (first page)** — skeleton cards, not a bare spinner.
- **Loading (next page)** — an indicator at the grid's foot; the existing
  cards stay put.
- **Error** — a stated failure with a retry, never an empty state.
- **Empty** — distinguish "no meetings yet" from "nothing matched your
  search", and offer to clear the search in the second case.

## Testing

**Unit:** the cursor's encode/decode round-trip, including a null
`scheduledAt`.

**API integration:**
- Pagination returns every meeting exactly once across pages, with no
  duplicates and no gaps, including rows with equal and null `scheduledAt`.
- `nextCursor` is null only on the final page.
- A confidential meeting a viewer may not read is **absent from every page**,
  and page sizes stay full — the regression test for the filter-after-fetch
  problem.
- The SQL visibility predicate agrees with `canReadMeeting` across all four
  combinations of confidential × attendee × admin.
- `q` matches title, location, type name and body name; a non-matching `q`
  returns an empty page with a null cursor, not an error.
- `limit` above the cap is clamped rather than honoured.

**Web:** cards render title and metadata; a long title is clamped, not
overflowing; the four states above are each distinguishable; scrolling to the
foot requests the next page exactly once.

**Contract:** a test asserting the requested URL and query parameters, per
the trailing-slash 404 that shipped because integration tests called routes
directly and never exercised the client's URL construction.

## Out of scope

- Searching PDF contents — Spec D.
- Sorting or filtering controls beyond the search box.
- Any change to the meeting detail dialog.
- Virtualised rendering. Cursor pagination is enough at this scale; revisit
  only if a workspace's grid actually becomes slow.
