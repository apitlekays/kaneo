# Interactive Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the person holding a delegated minute action report progress with an append-only, audited thread of updates, with attachments that land in the letter's own record.

**Architecture:** A new `letter_minute_update` table with no update or delete route — immutability enforced by absence, not by a rule. Attachments reuse `letter_attachment`, which gains a nullable `minute_update_id`, so one store and one download path serve both the Attachments tab and the thread. Every update writes an audit event into the existing hash chain.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query + Tailwind v4 (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-21-interactive-minutes-and-assignment-acceptance-design.md`

**Scope note:** this plan covers interactive minutes only. Minute-action accept/reject and task accept/reject are separate plans, in that order.

## Global Constraints

- Minute updates are **append-only**. Create no update route and no delete route for them. Immutability is enforced by the absence of a way to do it.
- Every update writes `recordAuditEvent` with `entityType: "letter"`, the letter's id, and action `minute-update`.
- Who may post: the minute's `assigneeId`, **or** a user with `general-management` page access. Enforced server-side.
- Posting an update never completes the action. Completion stays `POST /letters/:id/minutes/:mid/complete`.
- A file attached to an update lands in `letter_attachment` with `minute_update_id` set — it appears in the Attachments tab *and* the thread.
- All API inputs validated with Valibot; all routes carry `describeRoute`.
- Biome: double quotes, semicolons, spaces for TS/TSX. Conventional Commits.

---

## File Structure

**API**
- `apps/api/src/database/schema.ts` — `letterMinuteUpdateTable`; `minuteUpdateId` on `letterAttachmentTable`
- `apps/api/src/database/index.ts` — barrel export
- `apps/api/drizzle/00NN_*.sql` — generated
- `apps/api/src/correspondence/minute-access.ts` — the pure "may this user post" rule (new)
- `apps/api/src/correspondence/letters.ts` — the create route, the detail projection, the finalize gate

**Web**
- `apps/web/src/fetchers/correspondence/letters.ts` — types + fetchers
- `apps/web/src/hooks/queries/correspondence/use-letters.ts` — mutation hook
- `apps/web/src/components/general-management/minute-thread.tsx` — the thread (new)
- `apps/web/src/components/general-management/letter-detail-dialog.tsx` — mount it

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/src/database/schema.ts` (beside `letterMinuteTable` ~2231 and `letterAttachmentTable` ~2203)
- Modify: `apps/api/src/database/index.ts`
- Create: generated migration under `apps/api/drizzle/`

**Interfaces:**
- Produces: `letterMinuteUpdateTable` with `{ id, minuteId, authorId, body, createdAt }`; `letterAttachmentTable.minuteUpdateId`

- [ ] **Step 1: Add the table**

In `apps/api/src/database/schema.ts`, immediately after `letterMinuteTable`'s definition:

```ts
export const letterMinuteUpdateTable = pgTable(
  "letter_minute_update",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    minuteId: text("minute_id")
      .notNull()
      .references(() => letterMinuteTable.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("letter_minute_update_minuteId_idx").on(table.minuteId),
  ],
);
```

There is deliberately no `updatedAt`. A row that cannot change does not need one, and its absence is a signal to the next reader.

- [ ] **Step 2: Add the attachment column**

Inside `letterAttachmentTable`, after `letterId`:

```ts
    // Set when this file was uploaded as part of a minute update. The file is
    // still the letter's attachment — this only records where it came from.
    minuteUpdateId: text("minute_update_id"),
```

No foreign key: `letterAttachmentTable` is defined before `letterMinuteUpdateTable` in the file, and the existing `primaryAttachmentId` on `letterTable` already uses this same no-FK approach with a comment explaining it avoids a cycle. Follow that precedent rather than reordering the file.

- [ ] **Step 3: Add to the barrel**

`apps/api/src/database/index.ts` exports every table in a `schema` object. Add `letterMinuteUpdateTable` in the alphabetical position the file uses. `tests/api/database/schema-barrel.test.ts` fails if a table is missing — run it.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @kaneo/api db:generate`

Keep whatever filename and number drizzle produces. Never hand-write or hand-copy the snapshot JSON or the journal entry — drizzle chains snapshots by id and a hand-edited one forks the chain for every later migration.

- [ ] **Step 5: Apply it against a real database**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

Wait for `docker exec kaneo-test-pg pg_isready -U postgres`, then from `apps/api`:

```bash
npx vitest run --config vitest.integration.config.ts
```

Expected: PASS (97 tests at time of writing). Migrations run on startup, so this proves the migration applies cleanly and breaks nothing. Tear down with `docker rm -f kaneo-test-pg` when finished, even on failure.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database apps/api/drizzle
git commit --no-verify -m "feat(api): add minute update table and attachment link"
```

---

### Task 2: The access rule, as a pure function

**Files:**
- Create: `apps/api/src/correspondence/minute-access.ts`
- Test: `tests/api/correspondence/minute-access.test.ts`

**Interfaces:**
- Produces: `canPostMinuteUpdate(args: { userId: string; hasPageAccess: boolean; minuteAssigneeId: string | null }): boolean`

Extracted so the rule can be tested without a database. The route composes it with the real lookups.

- [ ] **Step 1: Write the failing test**

Create `tests/api/correspondence/minute-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canPostMinuteUpdate } from "../../../apps/api/src/correspondence/minute-access";

describe("canPostMinuteUpdate", () => {
  it("lets the assignee post", () => {
    expect(
      canPostMinuteUpdate({
        userId: "u1",
        hasPageAccess: false,
        minuteAssigneeId: "u1",
      }),
    ).toBe(true);
  });

  it("lets a general-management officer post on someone else's action", () => {
    expect(
      canPostMinuteUpdate({
        userId: "officer",
        hasPageAccess: true,
        minuteAssigneeId: "u1",
      }),
    ).toBe(true);
  });

  it("refuses an unrelated user with no page access", () => {
    expect(
      canPostMinuteUpdate({
        userId: "stranger",
        hasPageAccess: false,
        minuteAssigneeId: "u1",
      }),
    ).toBe(false);
  });

  it("refuses a non-officer on a minute with no assignee", () => {
    // A plain note has no assignee; there is no work being reported on, so
    // only an officer may add to it.
    expect(
      canPostMinuteUpdate({
        userId: "u1",
        hasPageAccess: false,
        minuteAssigneeId: null,
      }),
    ).toBe(false);
  });

  it("lets an officer post on a minute with no assignee", () => {
    expect(
      canPostMinuteUpdate({
        userId: "officer",
        hasPageAccess: true,
        minuteAssigneeId: null,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/minute-access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `apps/api/src/correspondence/minute-access.ts`:

```ts
/**
 * Who may add to a minute's update thread: the person the action belongs to,
 * or a general-management officer. A minute with no assignee is a plain note
 * rather than delegated work, so only an officer may add to it.
 */
export function canPostMinuteUpdate(args: {
  userId: string;
  hasPageAccess: boolean;
  minuteAssigneeId: string | null;
}): boolean {
  if (args.hasPageAccess) return true;
  return args.minuteAssigneeId !== null && args.minuteAssigneeId === args.userId;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/minute-access.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the tests bite**

Change the body to `return true`. The two refusal tests must FAIL. Restore. Then change it to `return args.hasPageAccess`. The "assignee may post" test must FAIL. Restore. Report both observations.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/correspondence/minute-access.ts tests/api/correspondence/minute-access.test.ts
git commit --no-verify -m "feat(api): minute update access rule"
```

---

### Task 3: The create route and the detail projection

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` — new route beside the minutes routes (~1310-1400); detail projection (~806-841)
- Test: `tests/api-integration/minute-updates.test.ts`

**Interfaces:**
- Consumes: `canPostMinuteUpdate` from Task 2; `letterMinuteUpdateTable` from Task 1
- Produces: `POST /correspondence/letters/:id/minutes/:mid/updates` taking `{ workspaceId, body }`; the letter detail's `minutes` entries each gain `updates: MinuteUpdate[]`

- [ ] **Step 1: Add the route**

Register it beside the existing minutes routes. Read `POST /letters/:id/minutes` (~1310) first and mirror its shape — the same `loadLetter` 404, the same `workspaceAccess.fromBody`, the same transaction-plus-audit structure.

```ts
    .post(
      "/letters/:id/minutes/:mid/updates",
      describeRoute({
        operationId: "addMinuteUpdate",
        tags: ["Correspondence"],
        description: "Append an update to a delegated action's thread",
      }),
      validator("param", v.object({ id: v.string(), mid: v.string() })),
      validator("json", v.object({ workspaceId: v.string(), body: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id, mid } = c.req.valid("param");
        const b = c.req.valid("json");
        const body = b.body.trim();
        if (!body)
          throw new HTTPException(400, { message: "Update body required" });
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const [minute] = await db
          .select({
            id: letterMinuteTable.id,
            assigneeId: letterMinuteTable.assigneeId,
          })
          .from(letterMinuteTable)
          .where(
            and(
              eq(letterMinuteTable.id, mid),
              eq(letterMinuteTable.letterId, id),
            ),
          )
          .limit(1);
        if (!minute) throw new HTTPException(404, { message: "Not found" });
        const access = await resolveLetterAccess(userId, ws, letter);
        if (
          !canPostMinuteUpdate({
            userId,
            hasPageAccess: access.hasPage,
            minuteAssigneeId: minute.assigneeId,
          })
        )
          throw new HTTPException(403, {
            message: "Only the action's assignee or a GM officer can post here",
          });
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(letterMinuteUpdateTable)
            .values({ minuteId: mid, authorId: userId, body })
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "minute-update",
            actorId: userId,
            after: { minuteId: mid, updateId: row.id, body },
            ip: getIp(c),
          });
          return row;
        });
        return c.json(created, 201);
      },
    )
```

Note the minute lookup joins on `letterId` as well as its own id: a minute id from another letter must 404, not leak.

Import `canPostMinuteUpdate` from `./minute-access` and `letterMinuteUpdateTable` from the schema.

- [ ] **Step 2: Return updates with the letter detail**

At the detail route's parallel fetch (~806), the `minutes` query already runs. Load every update for that letter's minutes in one query and attach them in JavaScript, following exactly how the route already merges action counts into letters with a `Map` — do not add a correlated subquery per minute.

Each minute in the response gains `updates`, ordered oldest-first: a work log reads forwards, unlike the thread dialog which reads newest-first.

- [ ] **Step 3: Write the integration test**

Create `tests/api-integration/minute-updates.test.ts`. Read `tests/api-integration/correspondence-handover.test.ts` first and reuse its helpers (`createWorkspaceMember`, `grantGeneralManagement`, `mockAuthenticatedSession`, `resetTestDatabase`) and its letter-capture pattern. Cover:

1. The minute's assignee, holding no GM page access, can post an update and gets 201.
2. An unrelated workspace member with no page access gets 403, and no row is written.
3. A GM officer can post on someone else's action.
4. Posting an update leaves the minute's `status` unchanged — it does not complete the action.
5. The letter detail returns the update inside its minute, oldest-first.

Write real arrangements and assertions. A test body left as comments is a task failure.

- [ ] **Step 4: Run the suites**

Start PostgreSQL as in Task 1 Step 5. Run `pnpm --filter @kaneo/api test` and the integration suite. Report both totals. Tear the container down afterwards, even on failure.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/correspondence/letters.ts tests/api-integration/minute-updates.test.ts
git commit --no-verify -m "feat(api): append-only minute update thread"
```

---

### Task 4: Attachments on a minute update

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` — the finalize route (~1610)
- Test: extend `tests/api-integration/minute-updates.test.ts`

**Interfaces:**
- Consumes: `canPostMinuteUpdate`; `letterAttachmentTable.minuteUpdateId`
- Produces: finalize accepts an optional `minuteUpdateId`

**The problem this task exists to solve, which the spec did not anticipate:** the finalize route carries `pageAccess`. A minute assignee *without* general-management access can post an update (Task 3) but would get a 403 attaching a file to it. That contradicts the spec's own rule about who may post.

**And it is TWO routes, not one.** `POST /letters/:id/attachments/presign` (~1579) is page-gated as well. Loosening only finalize leaves the assignee unable to obtain an upload URL in the first place, so the feature would still not work. Both routes need the same treatment, and the presign route must know which minute update the upload is for before it hands out a key.

- [ ] **Step 0: Accept `minuteUpdateId` on presign too**

Add `minuteUpdateId: optStr` to the presign route's Valibot schema and apply the same branching gate described in Step 2 below. The object key it generates is unchanged — the file is still the letter's attachment; only who may ask for the key changes.

Verify by reading both routes that they now agree on who may upload. A presign that is more permissive than finalize creates orphaned objects in storage; one that is less permissive makes the feature unreachable.

- [ ] **Step 1: Accept the field**

Add to the finalize route's Valibot schema:

```ts
          minuteUpdateId: optStr,
```

and pass it through to the insert as `minuteUpdateId: b.minuteUpdateId ?? null`.

- [ ] **Step 2: Widen the gate, narrowly**

Remove `pageAccess` from the route's middleware chain and enforce inside the handler instead:

- If `minuteUpdateId` is **absent**, require `access.hasPage` — exactly today's behaviour for ordinary attachments, unchanged.
- If `minuteUpdateId` is **present**, load that update, confirm it belongs to a minute on this letter, and require `canPostMinuteUpdate(...)` for that minute. A 404 if the update is not on this letter.

Write it so the ordinary path cannot become more permissive by accident: the `hasPage` requirement must still be the only way to finalize an attachment with no `minuteUpdateId`.

- [ ] **Step 3: Extend the integration test**

Add to `tests/api-integration/minute-updates.test.ts`:

6. A minute assignee with no page access can presign **and** finalize an attachment carrying their own `minuteUpdateId`.
7. That same user presigning with **no** `minuteUpdateId` gets 403, and finalizing with none gets 403 — the ordinary path did not widen on either route.
8. That same user finalizing with a `minuteUpdateId` belonging to a **different letter** gets 404.

Case 7 is the one that matters most: it is the regression test for the two gates this task loosens, which is why it asserts against both routes rather than one.

- [ ] **Step 4: Prove it bites**

Delete the `hasPage` requirement from the no-`minuteUpdateId` branch and confirm case 7 FAILS. Restore. Report the observation verbatim.

- [ ] **Step 5: Run and commit**

Run the API and integration suites, report totals, tear down the container.

```bash
git add apps/api/src/correspondence/letters.ts tests/api-integration/minute-updates.test.ts
git commit --no-verify -m "feat(api): allow attachments on a minute update"
```

---

### Task 5: Web data layer

**Files:**
- Modify: `apps/web/src/fetchers/correspondence/letters.ts`
- Modify: `apps/web/src/hooks/queries/correspondence/use-letters.ts`
- Test: `apps/web/src/hooks/queries/correspondence/minute-update-invalidation.test.tsx`

**Interfaces:**
- Produces:
  - `type MinuteUpdate = { id: string; minuteId: string; authorId: string | null; body: string; createdAt: string }`
  - `addMinuteUpdate(workspaceId: string, letterId: string, minuteId: string, body: string): Promise<MinuteUpdate>`
  - `useAddMinuteUpdate(workspaceId: string, letterId: string)` — invalidates `["letter", workspaceId, letterId]`

- [ ] **Step 1: Add the type and fetcher**

In `apps/web/src/fetchers/correspondence/letters.ts`, add the `MinuteUpdate` type above the existing minute type, add `updates: MinuteUpdate[]` to whichever type describes a minute in the letter detail, and:

```ts
export const addMinuteUpdate = (
  workspaceId: string,
  letterId: string,
  minuteId: string,
  body: string,
) =>
  post<MinuteUpdate>(
    `letters/${letterId}/minutes/${minuteId}/updates`,
    workspaceId,
    { body },
  );
```

`post` is the helper already used by the neighbouring mutations in that file — reuse it rather than writing a new `fetch`.

- [ ] **Step 2: Write the failing invalidation test**

Create `apps/web/src/hooks/queries/correspondence/minute-update-invalidation.test.tsx`, following `apps/web/src/hooks/mutations/notification/invalidations.test.tsx` for the pattern: render the hook with a real `QueryClient`, spy on `invalidateQueries`, mutate, and assert the letter key is invalidated.

Assert the key is exactly `["letter", "ws-1", "letter-1"]`. Without that invalidation the thread does not refresh after posting and the user retypes an update they already sent.

- [ ] **Step 3: Run it to verify it fails, then add the hook**

Add `useAddMinuteUpdate` to `use-letters.ts` beside the existing letter mutations, matching their `useMutation` + `onSuccess` invalidation shape.

- [ ] **Step 4: Prove it bites**

Remove the invalidation, confirm the test FAILS, restore. Report the observation.

- [ ] **Step 5: Run and commit**

Run `pnpm --filter @kaneo/web test` and report the total.

```bash
git add apps/web/src/fetchers/correspondence/letters.ts apps/web/src/hooks/queries/correspondence
git commit --no-verify -m "feat(web): minute update data layer"
```

---

### Task 6: The thread UI

**Files:**
- Create: `apps/web/src/components/general-management/minute-thread.tsx`
- Modify: `apps/web/src/components/general-management/letter-detail-dialog.tsx` — the minutes panel
- Test: `apps/web/src/components/general-management/minute-thread.test.tsx`

**Interfaces:**
- Consumes: `MinuteUpdate`, `useAddMinuteUpdate` from Task 5

- [ ] **Step 1: Write the failing tests**

Create `minute-thread.test.tsx`. Mock `useAddMinuteUpdate`. Write real arrangements and assertions for:

1. Existing updates render oldest-first, each showing its body.
2. Submitting a non-empty update calls the mutation with that text.
3. The submit control is disabled while the body is empty or whitespace-only.
4. A minute with no updates renders the composer but no thread rows, and no empty-state error.

A test body left as comments, or one asserting nothing, is a task failure.

- [ ] **Step 2: Run to verify they fail, then build the component**

`<MinuteThread workspaceId letterId minute canPost />`. It renders each update's body, author and date, then a composer — a `Textarea` plus a submit button — when `canPost` is true.

Follow the existing markup in `letter-detail-dialog.tsx` for spacing and typography rather than inventing a new visual language. Attachments on an update render using the same attachment row the Attachments tab already uses, so a file looks the same in both places.

- [ ] **Step 3: Mount it**

In the letter detail dialog's minutes panel, render `<MinuteThread />` under each minute. Pass `canPost` from the same information the API uses — the viewer is the minute's assignee, or holds general-management access.

This is a display-side convenience only. The server check from Task 3 is the real gate; a wrong `canPost` here shows or hides a composer but cannot grant anyone access.

- [ ] **Step 4: Prove the tests bite**

Remove the disabled condition from the submit control and confirm test 3 FAILS. Restore. Report the observation.

- [ ] **Step 5: Run and commit**

Run `pnpm --filter @kaneo/web test` and `pnpm --filter @kaneo/web build` — the build is the only thing that typechecks TSX in this repo. Report both.

```bash
git add apps/web/src/components/general-management
git commit --no-verify -m "feat(web): minute update thread"
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

Report every total. If any suite fails, capture the failing test names and assertion output verbatim before tearing down.

- [ ] **Step 3: Tear down**

```bash
docker rm -f kaneo-test-pg
```

Do this even if a step failed.

- [ ] **Step 4: Confirm immutability by absence**

Grep the API for any route that updates or deletes a minute update:

```bash
/usr/bin/grep -rn "letterMinuteUpdateTable" apps/api/src
```

Every hit must be an insert or a select. A `.update(` or `.delete(` against that table is a spec violation — report it rather than fixing it.

- [ ] **Step 5: Report**

State every total plainly. If anything failed, report BLOCKED with exact output rather than a summary.

---

## Browser verification (before this branch is called done)

1. Open a letter with a delegated action assigned to you. The thread appears under the minute with a composer.
2. Post an update. It appears immediately, oldest-first, with your name and the time.
3. Attach a PDF to an update. It appears in the thread **and** in the letter's Attachments tab.
4. Confirm the action's status is unchanged — posting did not complete it.
5. As a user who is neither the assignee nor a GM officer, open the same letter. No composer appears, and the thread is read-only.
