# Letter Linking and Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the half-built letter-linking feature — a picker to create links, readable bidirectional links on the letter, and a thread dialog reachable from the register.

**Architecture:** The `letter_link` table, its POST endpoint, and a `linkLetter` mutation already exist; the interface is a stub that renders raw ids, offers no way to create a link, and reads only one direction. This plan makes the detail query bidirectional, adds a bounded cycle-safe graph walk behind a new thread endpoint, and builds one picker component used from both the registration dialog and the detail view.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query + Base UI dialog (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-19-correspondence-register-fields-and-grouping-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-19-register-fields-and-year-grouping.md`. That plan creates `apps/web/src/lib/letter-reference.ts`, which this plan uses so a linked letter is named the same way everywhere. Run it first.

## Global Constraints

- The thread walk is **bidirectional**: any letter in a chain returns the same complete thread regardless of which one it is opened from.
- The walk carries a **visited set**. Links form a graph, not a tree; a cycle must not loop forever.
- The walk is **capped at 100 letters** and reports when it truncated.
- **Every hop is workspace-scoped.** A link pointing outside the reader's workspace must never surface a letter.
- Thread order is `receivedAt ?? letterDate ?? createdAt` **descending** — newest at top, down to the first correspondence. The same date the register groups by.
- A failed link never rolls back a registered letter. The reference number is already allocated from a gap-free sequence.
- All API inputs validated with Valibot; all routes carry `describeRoute`.
- Biome: double quotes, semicolons, spaces for TS/TSX. Conventional Commits.

---

## File Structure

**API**
- `apps/api/src/correspondence/letter-thread.ts` — the pure graph walk (new)
- `apps/api/src/correspondence/letters.ts` — bidirectional links on detail, new thread route, link count on the list

**Web**
- `apps/web/src/components/general-management/letter-link-picker.tsx` — the shared picker (new)
- `apps/web/src/components/general-management/letter-thread-dialog.tsx` — the thread dialog (new)
- `apps/web/src/fetchers/correspondence/letters.ts` — thread fetcher and types
- `apps/web/src/hooks/queries/correspondence/use-letters.ts` — thread query hook
- `apps/web/src/components/general-management/letter-capture-dialog.tsx` — picker + failure handling
- `apps/web/src/components/general-management/letter-detail-dialog.tsx` — readable links + picker
- `apps/web/src/components/general-management/correspondence.tsx` — thread icon column

---

### Task 1: The thread walk

**Files:**
- Create: `apps/api/src/correspondence/letter-thread.ts`
- Test: `tests/api/correspondence/letter-thread.test.ts`

**Interfaces:**
- Produces: `walkThread(seedId: string, edges: { fromLetterId: string; toLetterId: string }[], cap?: number): { ids: string[]; truncated: boolean }`

The walk is a pure function over an edge list so it can be tested exhaustively without a database. The route loads the workspace's edges and calls it.

- [ ] **Step 1: Write the failing test**

Create `tests/api/correspondence/letter-thread.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { walkThread } from "../../../apps/api/src/correspondence/letter-thread";

const edge = (from: string, to: string) => ({
  fromLetterId: from,
  toLetterId: to,
});

describe("walkThread", () => {
  it("returns just the seed when it has no links", () => {
    expect(walkThread("a", []).ids).toEqual(["a"]);
  });

  it("follows a link forwards", () => {
    expect(walkThread("a", [edge("a", "b")]).ids.sort()).toEqual(["a", "b"]);
  });

  it("follows a link backwards, so either end returns the same thread", () => {
    // B was recorded as a reply to A. Opening A must still find B.
    expect(walkThread("a", [edge("b", "a")]).ids.sort()).toEqual(["a", "b"]);
  });

  it("walks a chain transitively", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    expect(walkThread("c", edges).ids.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("terminates on a cycle", () => {
    // Two letters referencing each other would loop forever without a
    // visited set. This test hangs rather than fails if that is missing.
    const edges = [edge("a", "b"), edge("b", "a")];
    expect(walkThread("a", edges).ids.sort()).toEqual(["a", "b"]);
  });

  it("terminates on a self-link", () => {
    expect(walkThread("a", [edge("a", "a")]).ids).toEqual(["a"]);
  });

  it("stops at the cap and says it truncated", () => {
    const edges = Array.from({ length: 200 }, (_, i) =>
      edge(`l${i}`, `l${i + 1}`),
    );
    const result = walkThread("l0", edges, 10);
    expect(result.ids).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("does not claim truncation when the thread fits", () => {
    expect(walkThread("a", [edge("a", "b")], 10).truncated).toBe(false);
  });

  it("ignores edges belonging to unrelated letters", () => {
    const edges = [edge("a", "b"), edge("x", "y")];
    expect(walkThread("a", edges).ids.sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/letter-thread.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the walk**

Create `apps/api/src/correspondence/letter-thread.ts`:

```ts
type Edge = { fromLetterId: string; toLetterId: string };

/**
 * Collects every letter reachable from the seed through links, in either
 * direction, so opening a thread from any letter in a chain shows the whole
 * chain. Links form a graph rather than a tree — two letters can reference
 * each other — so the visited set is what makes this terminate, and the cap
 * is what stops one accidental web of links becoming an unbounded query.
 */
export function walkThread(
  seedId: string,
  edges: Edge[],
  cap = 100,
): { ids: string[]; truncated: boolean } {
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const existing = neighbours.get(from);
    if (existing) existing.push(to);
    else neighbours.set(from, [to]);
  };
  for (const e of edges) {
    link(e.fromLetterId, e.toLetterId);
    link(e.toLetterId, e.fromLetterId);
  }

  const visited = new Set<string>([seedId]);
  const queue = [seedId];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of neighbours.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (visited.size >= cap) {
        truncated = true;
        break;
      }
      visited.add(next);
      queue.push(next);
    }
    if (truncated) break;
  }

  return { ids: [...visited], truncated };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/letter-thread.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the tests bite**

Remove the `if (visited.has(next)) continue;` guard and re-run **with a timeout** — the cycle test must fail or hang rather than pass. Restore. Then remove the reverse `link(e.toLetterId, e.fromLetterId)` and confirm the "follows a link backwards" test FAILS. Restore. Report both.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/correspondence/letter-thread.ts tests/api/correspondence/letter-thread.test.ts
git commit --no-verify -m "feat(api): cycle-safe bidirectional letter thread walk"
```

---

### Task 2: Bidirectional links, the thread route, and the list link count

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` — the detail query (~709), the list route (~500-525), and a new route
- Test: `tests/api-integration/letter-thread.test.ts`

**Interfaces:**
- Consumes: `walkThread` from Task 1
- Produces: `GET /correspondence/letters/:id/thread?workspaceId=` returning `{ letters: ThreadEntry[]; truncated: boolean }` where `ThreadEntry` is `{ id, refNo, externalRefNo, subject, direction, date, isSeed }`; list rows gain `linkCount: number`

- [ ] **Step 1: Make the detail query bidirectional**

At `letters.ts:709`, the links subquery reads `where(eq(letterLinkTable.fromLetterId, id))`. Replace it with a query returning both directions, tagging which way each link points so the UI can label them differently:

```ts
          const outbound = await db
            .select()
            .from(letterLinkTable)
            .where(eq(letterLinkTable.fromLetterId, id));
          const inbound = await db
            .select()
            .from(letterLinkTable)
            .where(eq(letterLinkTable.toLetterId, id));
          const links = [
            ...outbound.map((l) => ({ ...l, outbound: true })),
            ...inbound.map((l) => ({ ...l, outbound: false })),
          ];
```

The existing detail response already includes `links`; keep the field name so nothing else breaks.

- [ ] **Step 2: Add the link count to the list route**

The list route already computes per-letter action counts with a grouped aggregate joined in JavaScript through a `Map` (`letters.ts:500-524`). Follow that exact shape — do not switch to a correlated subquery.

Count links in both directions for the workspace's letters, then merge:

```ts
        const linkRows = await db
          .select({
            letterId: letterLinkTable.fromLetterId,
            n: sql<number>`count(*)::int`,
          })
          .from(letterLinkTable)
          .innerJoin(letterTable, eq(letterLinkTable.fromLetterId, letterTable.id))
          .where(eq(letterTable.workspaceId, ws))
          .groupBy(letterLinkTable.fromLetterId);
        const inboundRows = await db
          .select({
            letterId: letterLinkTable.toLetterId,
            n: sql<number>`count(*)::int`,
          })
          .from(letterLinkTable)
          .innerJoin(letterTable, eq(letterLinkTable.toLetterId, letterTable.id))
          .where(eq(letterTable.workspaceId, ws))
          .groupBy(letterLinkTable.toLetterId);
        const linkMap = new Map<string, number>();
        for (const r of [...linkRows, ...inboundRows])
          linkMap.set(r.letterId, (linkMap.get(r.letterId) ?? 0) + r.n);
```

Then add `linkCount: linkMap.get(r.id) ?? 0` to the object built in the existing `filtered.map(...)` alongside `actionsTotal` and `actionsDone`.

- [ ] **Step 3: Add the thread route**

Register it BEFORE any `"/letters/:id"` route so the path segment is not swallowed, the same way `"/letters/awaiting-acceptance"` is placed early (see the comment at `letters.ts:599`).

```ts
    .get(
      "/letters/:id/thread",
      describeRoute({
        operationId: "getLetterThread",
        tags: ["Correspondence"],
        description: "Every letter linked to this one, newest first",
      }),
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { id } = c.req.valid("param");
        // Only edges whose BOTH ends live in this workspace. A link pointing
        // outside it must never surface a letter the reader cannot see.
        const edges = await db
          .select({
            fromLetterId: letterLinkTable.fromLetterId,
            toLetterId: letterLinkTable.toLetterId,
          })
          .from(letterLinkTable)
          .innerJoin(letterTable, eq(letterLinkTable.fromLetterId, letterTable.id))
          .where(eq(letterTable.workspaceId, ws));
        const { ids, truncated } = walkThread(id, edges);
        const rows = await db
          .select({
            id: letterTable.id,
            refNo: letterTable.refNo,
            externalRefNo: letterTable.externalRefNo,
            subject: letterTable.subject,
            direction: letterTable.direction,
            receivedAt: letterTable.receivedAt,
            letterDate: letterTable.letterDate,
            createdAt: letterTable.createdAt,
          })
          .from(letterTable)
          .where(
            and(inArray(letterTable.id, ids), eq(letterTable.workspaceId, ws)),
          );
        const letters = rows
          .map((r) => ({
            ...r,
            date: r.receivedAt ?? r.letterDate ?? r.createdAt,
            isSeed: r.id === id,
          }))
          .sort((a, b) => b.date.getTime() - a.date.getTime());
        return c.json({ letters, truncated });
      },
    )
```

Note: the edge query joins on `fromLetterId` only. That is deliberate and sufficient — a link row survives only if its `from` end is in this workspace, and the final `inArray` + `workspaceId` filter drops any `to` end that is not. Satisfy yourself this holds before committing, and say in your report how you checked.

Import `walkThread` from `./letter-thread`, and `inArray` from `drizzle-orm` if not already imported.

- [ ] **Step 4: Write the integration test**

Create `tests/api-integration/letter-thread.test.ts`. Read `tests/api-integration/correspondence-handover.test.ts` first and reuse its helpers and its `captureLetter` pattern. Cover:

1. Three letters chained A→B→C. `GET /letters/B/thread` returns all three, newest first by date.
2. `GET /letters/A/thread` returns the same three — proving the walk is bidirectional through a real database.
3. A letter in another workspace, linked in, is NOT returned.
4. A letter with no links returns only itself, `truncated: false`.

Write real arrangements and assertions. A test body left as comments is a task failure.

- [ ] **Step 5: Run the suites**

Start PostgreSQL:

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

Then `pnpm --filter @kaneo/api test` and, from `apps/api`, `npx vitest run --config vitest.integration.config.ts`. Tear down with `docker rm -f kaneo-test-pg` when finished, even on failure.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/correspondence/letters.ts tests/api-integration/letter-thread.test.ts
git commit --no-verify -m "feat(api): bidirectional links, thread route and list link counts"
```

---

### Task 3: The link picker component

**Files:**
- Create: `apps/web/src/components/general-management/letter-link-picker.tsx`
- Test: `apps/web/src/components/general-management/letter-link-picker.test.tsx`

**Interfaces:**
- Produces: `<LetterLinkPicker workspaceId value onChange excludeId? />` where `value: PendingLink[]`, `PendingLink = { toLetterId: string; relation: "reply" | "related" | "supersedes"; label: string }`, and `onChange(next: PendingLink[]): void`

The picker is controlled and holds no server state of its own, so both the registration dialog (which has no letter id yet) and the detail view can use it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/general-management/letter-link-picker.test.tsx`. Mock the letters query hook the picker uses. Assert behaviour:

```tsx
// Tests to write, each with a real arrangement and real assertions:
//
// 1. "filters the candidate list by what the user types" — type part of a
//    subject, assert only matching letters remain visible.
// 2. "adds a chosen letter to the value with the selected relation" — pick a
//    relation and a letter, assert onChange received one PendingLink with
//    both.
// 3. "removes a link" — start with one link in value, click its remove
//    control, assert onChange received an empty array.
// 4. "never offers the letter being edited as its own link" — pass
//    excludeId and assert that letter is absent from the candidates.
```

Fill each in. A test body left as comments is a task failure.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/components/general-management/letter-link-picker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the picker**

Create the component. It:

- reads candidates from the existing letters list query for the workspace (the endpoint returns every letter unpaginated, so filter client-side — no new endpoint)
- filters on a typed term against `subject`, `refNo` and `externalRefNo`
- excludes `excludeId` when given
- shows each candidate using `letterReference(letter)` from `@/lib/letter-reference` plus its subject, so a linked letter is named the same way it is named in the register
- offers the three relations `reply`, `related`, `supersedes` in a select
- renders the current `value` as removable chips

Follow the existing form-control patterns in `letter-capture-dialog.tsx`; do not introduce a new UI library or a combobox abstraction the codebase does not already use. `@/components/ui/combobox` and `@/components/ui/autocomplete` both exist — read them and use one if it fits rather than hand-rolling.

- [ ] **Step 4: Run to verify it passes, then prove it bites**

Run the test file — expect PASS, 4 tests. Then remove the `excludeId` filter and confirm test 4 FAILS. Restore.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/general-management/letter-link-picker.tsx apps/web/src/components/general-management/letter-link-picker.test.tsx
git commit --no-verify -m "feat(web): reusable letter link picker"
```

---

### Task 4: The picker in registration, with honest failure handling

**Files:**
- Modify: `apps/web/src/components/general-management/letter-capture-dialog.tsx`
- Test: `apps/web/src/components/general-management/letter-capture-links.test.tsx`

**Interfaces:**
- Consumes: `<LetterLinkPicker />` from Task 3; the existing `linkLetter` mutation (`use-letters.ts:136`)

**The sequencing constraint this task exists to handle:** a link needs both letter ids, and the letter being registered has none until it is created. So the dialog holds pending links in local state and posts them after the create resolves.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/general-management/letter-capture-links.test.tsx`. Mock the create and link mutations. Assert:

```tsx
// 1. "posts each chosen link against the new letter's id after creation" —
//    create resolves with id "new-1"; assert linkLetter was called once per
//    chosen link, each with "new-1".
// 2. "keeps the letter and reports which links failed" — make the second of
//    three link posts reject. Assert the dialog stays open, names the
//    failure, and does NOT call any delete/rollback on the created letter.
// 3. "retries only the failed links" — click Retry; assert linkLetter is
//    called again only for the one that failed, not all three.
```

Fill each in with real arrangements and assertions.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/components/general-management/letter-capture-links.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Wire the picker and the post-create sequence**

In `letter-capture-dialog.tsx`:

```tsx
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [failedLinks, setFailedLinks] = useState<PendingLink[]>([]);
  const [registeredRef, setRegisteredRef] = useState<string | null>(null);
```

After the create mutation resolves, post the links with `Promise.allSettled` — one failure must not prevent the others — then:

- if all settled fulfilled, reset and close as the dialog does today
- if any rejected, keep the dialog open, set `failedLinks` to the rejected ones and `registeredRef` to the new letter's reference

**Never delete or roll back the created letter.** Its reference number has already been allocated from a gap-free sequence; withdrawing it would leave a hole in a register whose whole point is that it has none.

- [ ] **Step 4: Render the failure state**

When `failedLinks.length > 0`, replace the dialog's normal footer with a message and a Retry action:

> Letter registered as {registeredRef}. {n} of {total} links could not be saved.

The Retry action re-posts only `failedLinks`, clearing the ones that then succeed. A Close action is always available — the detail view carries the same picker, so a failed link is never a dead end. Add the i18n keys the file's conventions require.

- [ ] **Step 5: Run, prove it bites, commit**

Run the file — expect PASS, 3 tests. Then make the failure path close the dialog anyway and confirm test 2 FAILS. Restore.

```bash
git add apps/web/src/components/general-management/letter-capture-dialog.tsx apps/web/src/components/general-management/letter-capture-links.test.tsx
git commit --no-verify -m "feat(web): link letters at registration with recoverable failures"
```

---

### Task 5: Readable links and a picker in the detail view

**Files:**
- Modify: `apps/web/src/components/general-management/letter-detail-dialog.tsx` (the Linked panel ~313-329)
- Modify: `apps/web/src/fetchers/correspondence/letters.ts` (the link type carries `outbound`)

**Interfaces:**
- Consumes: bidirectional `links` from Plan-2 Task 2; `<LetterLinkPicker />` from Task 3; `letterReference` from the fields plan

- [ ] **Step 1: Replace the raw id rendering**

The panel currently renders `{l.toLetterId}` — a CUID, meaningless to a reader. Render instead, for each link, the counterpart's reference (via `letterReference`), subject and direction, as a clickable row that opens that letter.

The link rows carry only ids, so resolve them against the letters list already in the query cache for this workspace; if a counterpart is absent from that list, fall back to showing its id rather than rendering an empty row.

- [ ] **Step 2: Label the two directions differently**

An outbound link and an inbound one mean different things. Use the `outbound` flag:

- outbound `reply` → "Reply to {ref}"
- inbound `reply` → "Replied to by {ref}"
- outbound `supersedes` → "Supersedes {ref}"
- inbound `supersedes` → "Superseded by {ref}"
- either `related` → "Related to {ref}"

Add the i18n keys the file's conventions require.

- [ ] **Step 3: Add the picker to the panel**

Mount `<LetterLinkPicker excludeId={letter.id} …/>` in the Linked panel with an Add action that calls the existing `linkLetter` mutation for each chosen link and invalidates `["letter", workspaceId, letter.id]` so the panel refreshes.

- [ ] **Step 4: Verify and commit**

Run `pnpm --filter @kaneo/web test` and `pnpm --filter @kaneo/web build`. There is no existing test harness for this dialog; state plainly in your report whether you verified the panel by running the app or only by type-checking.

```bash
git add apps/web/src/components/general-management/letter-detail-dialog.tsx apps/web/src/fetchers/correspondence/letters.ts
git commit --no-verify -m "feat(web): readable bidirectional links with an inline picker"
```

---

### Task 6: The thread icon and the thread dialog

**Files:**
- Create: `apps/web/src/components/general-management/letter-thread-dialog.tsx`
- Modify: `apps/web/src/components/general-management/correspondence.tsx`
- Modify: `apps/web/src/fetchers/correspondence/letters.ts` — `getLetterThread`
- Modify: `apps/web/src/hooks/queries/correspondence/use-letters.ts` — `useLetterThread`
- Test: `apps/web/src/components/general-management/letter-thread-dialog.test.tsx`

**Interfaces:**
- Consumes: `GET /correspondence/letters/:id/thread` and `linkCount` from Plan-2 Task 2

- [ ] **Step 1: Add the fetcher and hook**

In `apps/web/src/fetchers/correspondence/letters.ts`:

```ts
export type ThreadEntry = {
  id: string;
  refNo: string | null;
  externalRefNo: string | null;
  subject: string;
  direction: string;
  date: string;
  isSeed: boolean;
};

export async function getLetterThread(
  workspaceId: string,
  id: string,
): Promise<{ letters: ThreadEntry[]; truncated: boolean }> {
  return jsonOrThrow(
    await fetch(
      url(`letters/${id}/thread?workspaceId=${encodeURIComponent(workspaceId)}`),
      { credentials: "include" },
    ),
  );
}
```

In `use-letters.ts`, add a query hook keyed `["letter-thread", workspaceId, id]`, enabled only when both are set.

- [ ] **Step 2: Write the failing dialog test**

Create `letter-thread-dialog.test.tsx`. Mock the thread hook. Assert:

```tsx
// 1. "lists the thread newest first with the current letter marked" —
//    three entries, one isSeed; assert order and that the seed is
//    distinguished.
// 2. "says so when the thread was truncated" — truncated: true renders a
//    notice; truncated: false renders none.
// 3. "shows the ERN for an incoming entry and the ref for an outgoing one" —
//    asserts it uses the same naming as the register.
```

Fill each in with real assertions.

- [ ] **Step 3: Build the dialog**

Create `letter-thread-dialog.tsx`: a controlled Base UI dialog (follow `pending-decision-dialog.tsx` for the controlled pattern and `DialogPanel` for the scrollable body). It lists each entry with `letterReference(entry)`, subject, direction and date, newest first — the API already sorts, so do not re-sort. The seed entry is visually distinguished. Clicking an entry opens that letter. When `truncated`, render a line saying the thread was too long to show in full.

- [ ] **Step 4: Add the icon column to the register**

In `correspondence.tsx`, add a narrow column. Render a button with a link icon **only** when `letter.linkCount > 0`; render nothing otherwise. Clicking it opens the thread dialog for that letter and must not also open the letter detail — stop the row's click from firing.

Remember the year-heading rows use `colSpan` across every column; bump it for the new one.

- [ ] **Step 5: Run, prove it bites, commit**

Run `pnpm --filter @kaneo/web test` — expect PASS. Then render the icon unconditionally and confirm a test asserting its absence for an unlinked letter FAILS; if no such test exists, add one first. Restore.

```bash
git add apps/web/src/components/general-management/letter-thread-dialog.tsx apps/web/src/components/general-management/letter-thread-dialog.test.tsx apps/web/src/components/general-management/correspondence.tsx apps/web/src/fetchers/correspondence/letters.ts apps/web/src/hooks/queries/correspondence/use-letters.ts
git commit --no-verify -m "feat(web): thread dialog reachable from the register"
```

---

### Task 7: Full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Start PostgreSQL**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

- [ ] **Step 2: Run everything**

```bash
pnpm test
pnpm --filter @kaneo/web build
cd apps/api && npx vitest run --config vitest.integration.config.ts
```

- [ ] **Step 3: Tear down**

```bash
docker rm -f kaneo-test-pg
```

Do this even if a step failed.

- [ ] **Step 4: Report every total.** If anything failed, report BLOCKED with exact output.

---

## Browser verification (before this branch is called done)

1. Register a letter and attach two links to existing letters. Both appear on its detail view, named by reference and subject, not by id.
2. Open one of those linked letters. It shows the relationship from its side, labelled "Replied to by …" rather than "Reply to …".
3. In the register, the linked letters show a thread icon; unlinked ones show none.
4. Click the icon. The thread dialog lists the chain newest first, with the letter you came from marked.
5. Click an entry in the thread. It opens that letter.
6. Force a link failure (stop the API mid-registration). The dialog stays open, says the letter was registered, names the failed link, and Retry re-posts only that one.
