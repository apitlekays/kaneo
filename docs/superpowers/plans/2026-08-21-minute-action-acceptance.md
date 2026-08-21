# Minute-Action Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A delegated minute action must be accepted or rejected by the person it is given to, through the accept/reject dialog that already exists.

**Architecture:** One `acceptance` column on `letter_minute`, defaulting to `'accepted'` so every existing action is grandfathered without a backfill statement. A new `minute-action` provider in the pending-decision registry supplies the dialog; the minute's existing `authorId` is the officer a rejection notifies, so no assignment table is needed.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-21-interactive-minutes-and-assignment-acceptance-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-21-interactive-minutes.md`. Run it first — a rejected action's thread is where the reason is read.

## Global Constraints

- `acceptance` holds exactly `pending | accepted | rejected`, `NOT NULL DEFAULT 'accepted'`.
- The default does the grandfathering. Write **no** backfill statement for minutes.
- Self-delegation is auto-accepted: if `assigneeId === authorId`, write `accepted` directly and never prompt.
- Rejecting sets `assigneeId` to null, `acceptance` to `rejected`, stores the reason, and notifies `authorId`.
- A rejected minute stays in the letter's history showing it was delegated and declined, with the reason. It is never deleted.
- `requiresReason: true` on the provider — a rejection always carries a written reason.
- All API inputs validated with Valibot; all routes carry `describeRoute`.
- Biome: double quotes, semicolons, spaces for TS/TSX. Conventional Commits.

---

### Task 1: The acceptance column

**Files:**
- Modify: `apps/api/src/database/schema.ts` (`letterMinuteTable`, ~2231)
- Create: generated migration

- [ ] **Step 1: Add the column**

Inside `letterMinuteTable`, after `status`:

```ts
    // pending | accepted | rejected. Only meaningful when assigneeId is set.
    // Defaults to accepted so every action delegated before this column
    // existed is grandfathered without a backfill statement to get wrong.
    acceptance: text("acceptance").notNull().default("accepted"),
    rejectionReason: text("rejection_reason"),
```

- [ ] **Step 2: Generate and apply**

Run `pnpm --filter @kaneo/api db:generate`, keeping drizzle's filename and number. Never hand-edit the snapshot or journal.

Start PostgreSQL and run the integration suite to prove it applies:

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

then from `apps/api`: `npx vitest run --config vitest.integration.config.ts`. Tear down with `docker rm -f kaneo-test-pg` afterwards, even on failure.

- [ ] **Step 3: Verify the grandfathering actually grandfathers**

Against a database that already held a delegated minute before the migration, confirm its `acceptance` reads `accepted`. The integration suite truncates between tests, so if you cannot show this there, apply the migration to a fresh database with a pre-seeded minute and check there instead — and say plainly which you did.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database apps/api/drizzle
git commit --no-verify -m "feat(api): add acceptance state to minute actions"
```

---

### Task 2: The decision rules, as pure functions

**Files:**
- Create: `apps/api/src/correspondence/minute-decision.ts`
- Test: `tests/api/correspondence/minute-decision.test.ts`

**Interfaces:**
- Produces:
  - `assertCanDecideMinute(minute: { assigneeId: string | null; acceptance: string }, userId: string): void` — throws `HTTPException(403)` unless the caller is the assignee, `HTTPException(409)` if already decided
  - `minuteAfterDecision(decision: "accepted" | "rejected"): { assigneeId: null | "keep"; acceptance: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/api/correspondence/minute-decision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertCanDecideMinute,
  minuteAfterDecision,
} from "../../../apps/api/src/correspondence/minute-decision";

describe("assertCanDecideMinute", () => {
  it("lets the assignee decide a pending action", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "pending" }, "u1"),
    ).not.toThrow();
  });

  it("refuses anyone who is not the assignee", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "pending" }, "u2"),
    ).toThrow();
  });

  it("refuses an action with no assignee", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: null, acceptance: "pending" }, "u1"),
    ).toThrow();
  });

  it("refuses a second decision on an already-accepted action", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "accepted" }, "u1"),
    ).toThrow();
  });

  it("refuses a second decision on an already-rejected action", () => {
    expect(() =>
      assertCanDecideMinute({ assigneeId: "u1", acceptance: "rejected" }, "u1"),
    ).toThrow();
  });
});

describe("minuteAfterDecision", () => {
  it("keeps the assignee on accept", () => {
    expect(minuteAfterDecision("accepted")).toEqual({
      assigneeId: "keep",
      acceptance: "accepted",
    });
  });

  it("clears the assignee on reject", () => {
    // The action returns to nobody. The officer who delegated it is
    // notified; it is not silently handed back to them as their own work.
    expect(minuteAfterDecision("rejected")).toEqual({
      assigneeId: null,
      acceptance: "rejected",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/minute-decision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/correspondence/minute-decision.ts`:

```ts
import { HTTPException } from "hono/http-exception";

/**
 * Only the person holding the action may decide it, and only once. A second
 * decision is a 409 rather than a silent overwrite: two people racing the
 * dialog must not both believe they settled it.
 */
export function assertCanDecideMinute(
  minute: { assigneeId: string | null; acceptance: string },
  userId: string,
): void {
  if (!minute.assigneeId || minute.assigneeId !== userId)
    throw new HTTPException(403, {
      message: "Only the action's assignee can decide it",
    });
  if (minute.acceptance !== "pending")
    throw new HTTPException(409, {
      message: "This action was already decided",
    });
}

export function minuteAfterDecision(decision: "accepted" | "rejected"): {
  assigneeId: null | "keep";
  acceptance: string;
} {
  return decision === "accepted"
    ? { assigneeId: "keep", acceptance: "accepted" }
    : { assigneeId: null, acceptance: "rejected" };
}
```

- [ ] **Step 4: Run to verify it passes, then prove it bites**

Expected: PASS, 7 tests. Then remove the `acceptance !== "pending"` check and confirm both already-decided tests FAIL. Restore. Report the observation.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/correspondence/minute-decision.ts tests/api/correspondence/minute-decision.test.ts
git commit --no-verify -m "feat(api): minute action decision rules"
```

---

### Task 3: Write pending on delegation, and the provider

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` — the minute create route (~1310)
- Create: `apps/api/src/pending-decision/providers/minute-action.ts`
- Modify: `apps/api/src/pending-decision/registry.ts`
- Test: `tests/api/pending-decision/minute-action-provider.test.ts`

**Interfaces:**
- Consumes: `assertCanDecideMinute`, `minuteAfterDecision` from Task 2
- Produces: `minuteActionProvider: PendingDecisionProvider` with `source: "minute-action"`; `toPendingItem(row)` exported pure

- [ ] **Step 1: Write pending on delegation**

In the minute create route, when `assigneeId` is set, write `acceptance` explicitly:

```ts
              acceptance: assigneeId && assigneeId !== userId ? "pending" : "accepted",
```

Self-delegation is auto-accepted — asking someone to accept work they just gave themselves is ceremony with no reader, and the notification handlers already carry the same `!== userId` guard.

- [ ] **Step 2: Write the failing provider test**

Create `tests/api/pending-decision/minute-action-provider.test.ts`. Test the exported pure mapper, not the database-backed `list`:

```ts
import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/minute-action";

const row = {
  id: "m1",
  letterId: "l1",
  body: "Draft a reply by Friday",
  actionType: "For your action",
  dueAt: new Date("2026-09-01T00:00:00.000Z"),
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
  refNo: "MAPIM/2026/0114",
  subject: "Permohonan kerjasama",
};

describe("minute-action toPendingItem", () => {
  it("names the item by the letter, not the minute id", () => {
    const item = toPendingItem(row);
    expect(item.source).toBe("minute-action");
    expect(item.title).toBe("MAPIM/2026/0114");
    expect(item.id).toBe("m1");
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row).requiresReason).toBe(true);
  });

  it("carries the action body so the reader knows what they are accepting", () => {
    expect(toPendingItem(row).context.join(" ")).toContain(
      "Draft a reply by Friday",
    );
  });

  it("falls back to the subject when the letter has no reference yet", () => {
    expect(toPendingItem({ ...row, refNo: null }).title).toBe(
      "Permohonan kerjasama",
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails, then build the provider**

Create `apps/api/src/pending-decision/providers/minute-action.ts`. Read `providers/correspondence.ts` first and mirror its structure exactly — the same `PendingDecisionProvider` shape, the same exported pure mapper, the same `href` convention pointing at the letter.

`list` selects minutes joined to their letter where `letterTable.workspaceId = ws`, `assigneeId = userId`, `acceptance = 'pending'`, and the letter is not sealed — reuse `SEALED_LETTER_STATUSES` exactly as the correspondence provider does, so an action on an archived record is never offered as a decision nobody can clear.

`decide` loads the minute scoped to the workspace, calls `assertCanDecideMinute`, applies `minuteAfterDecision`, writes the reason on reject, records an audit event with action `minute-accept` or `minute-reject`, and notifies `authorId` on reject. Reject with an empty or whitespace-only reason throws `HTTPException(400)` before any write — mirror the guard in `providers/correspondence.ts`.

Register it in `registry.ts` beside the correspondence provider.

- [ ] **Step 4: Prove the tests bite**

Remove `requiresReason: true` and confirm that test FAILS. Restore. Report the observation.

- [ ] **Step 5: Run and commit**

Run `pnpm --filter @kaneo/api test` and report the total.

```bash
git add apps/api/src/pending-decision apps/api/src/correspondence/letters.ts tests/api/pending-decision
git commit --no-verify -m "feat(api): minute actions await acceptance"
```

---

### Task 4: Hide pending actions from the work queues

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` — the my-correspondence action counts (~500-525) and the pending-action list
- Test: `tests/api-integration/minute-acceptance.test.ts`

**Interfaces:**
- Consumes: everything above

**Why this task is separate:** the acceptance column means nothing until the rest of the system stops treating a pending action as work in progress. This is the task that makes the feature real rather than decorative.

- [ ] **Step 1: Exclude pending actions from delegated-action progress**

The letters list computes `actionsTotal` / `actionsDone` from minutes with an assignee (~500-525). A pending action is not yet anyone's work, so it must not count toward either. Add `eq(letterMinuteTable.acceptance, "accepted")` to that aggregate's `where`.

- [ ] **Step 2: Write the integration test**

Create `tests/api-integration/minute-acceptance.test.ts`, reusing the helpers in `tests/api-integration/correspondence-handover.test.ts`. Cover:

1. Delegating an action to another user leaves it `pending`, and it appears in that user's `GET /pending-decision`.
2. Delegating to yourself writes `accepted` and produces no pending item.
3. Accepting keeps the assignee and sets `accepted`.
4. Rejecting with a reason clears the assignee, sets `rejected`, stores the reason, and leaves the minute in the letter's history.
5. Rejecting with an empty reason returns 400 and changes nothing.
6. A pending action does not count toward the letter's `actionsTotal`.
7. A second decision on the same action returns 409.

Real arrangements, real assertions. A comments-only body is a task failure. Case 6 is the one that proves the feature is not decorative.

- [ ] **Step 3: Run everything**

Start PostgreSQL, run `pnpm test` and the integration suite, report all totals, tear the container down even on failure.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/correspondence/letters.ts tests/api-integration/minute-acceptance.test.ts
git commit --no-verify -m "feat(api): pending actions are not yet work in progress"
```

---

### Task 5: Web surface

**Files:**
- Modify: `apps/web/src/fetchers/correspondence/letters.ts` — minute type gains `acceptance`, `rejectionReason`
- Modify: `apps/web/src/components/general-management/letter-detail-dialog.tsx` — show the state on each minute
- Test: extend an existing detail-adjacent test if one exists; otherwise state plainly that only the build typechecks this

**Interfaces:**
- Consumes: the API fields above

- [ ] **Step 1: Extend the type**

Add `acceptance: string` and `rejectionReason: string | null` to whichever type describes a minute in the letter detail.

- [ ] **Step 2: Show the state**

On each minute with an assignee, render its acceptance state beside the assignee's name: pending renders "Awaiting acceptance"; rejected renders "Declined" together with the reason. Accepted renders nothing extra — the common case should not shout.

Use the existing `Badge` component and match the markup already in that file rather than introducing new visual language.

- [ ] **Step 3: Nothing new is needed for the dialog itself**

The accept/reject dialog, its chime, toast and sidebar dot already render whatever the registry returns. Confirm by reading `apps/web/src/components/pending-decision-dialog.tsx` that it needs no change, and say so in your report. If it does need one, that is a finding — report it rather than quietly editing the shared component.

- [ ] **Step 4: Run and commit**

Run `pnpm --filter @kaneo/web test` and `pnpm --filter @kaneo/web build`. Report both. State plainly whether you ran the app or only type-checked.

```bash
git add apps/web/src
git commit --no-verify -m "feat(web): show minute acceptance state"
```

---

### Task 6: Full verification

**Files:** none — runs only.

- [ ] **Step 1: Start PostgreSQL, run everything**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

```bash
pnpm test
pnpm --filter @kaneo/web build
cd apps/api && npx vitest run --config vitest.integration.config.ts
```

- [ ] **Step 2: Confirm no minute backfill was written**

```bash
/usr/bin/grep -rn "acceptance" apps/api/drizzle/*.sql
```

Expect only the `ADD COLUMN ... DEFAULT 'accepted'`. An `UPDATE letter_minute SET acceptance` statement is a spec violation — the default is the grandfathering. Report it rather than fixing it.

- [ ] **Step 3: Tear down and report**

`docker rm -f kaneo-test-pg`, even on failure. State every total. Report BLOCKED with exact output if anything failed.

---

## Browser verification

1. Delegate an action to another user. Their dialog pops with the letter's reference and the action body; a chime sounds once.
2. Accept it. The action shows as theirs and counts toward the letter's action progress.
3. Delegate another and reject it with a reason. The action shows "Declined" with the reason, the assignee is cleared, and the delegating officer is notified.
4. Delegate an action to yourself. No prompt appears.
