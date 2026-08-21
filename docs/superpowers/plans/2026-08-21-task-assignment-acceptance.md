# Task Assignment Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project task assigned to someone is not theirs until they accept it; rejecting it returns the task to unassigned and tells whoever assigned it why.

**Architecture:** A `task_assignment` table shaped after `letter_assignment`, giving the task module an assignment lifecycle it has never had — including `fromUserId`, which nothing records today. `task.userId` comes to mean *the accepted assignee* and is written only on acceptance. A `task` provider in the pending-decision registry supplies the existing dialog.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-21-interactive-minutes-and-assignment-acceptance-design.md`

**Depends on:** nothing in the other two plans technically, but ship it last. It changes how assignment behaves in the module the team uses daily, and the other two exercise the same dialog on lower-stakes ground first.

## Global Constraints

- `task_assignment.status` holds exactly `pending | accepted | rejected | superseded`.
- `task.userId` means **the accepted assignee**. It is written only when someone accepts, and cleared on rejection.
- A task with a pending assignment shows as unassigned and is **excluded from "my tasks"**.
- Rejecting sets `task.userId` to null and notifies `fromUserId` with the reason. The task does **not** move to the assigner's board.
- **`fromUserId` may be null** on grandfathered rows. Rejection must then unassign and notify nobody — never crash, never invent an assigner.
- Self-assignment is auto-accepted: write `accepted` directly, never prompt.
- Reassigning a task with an outstanding pending assignment **supersedes** it. Exactly one live prompt per task.
- Every existing assigned task is grandfathered as `accepted`. Nobody is prompted for work already underway.
- `requiresReason: true` — a rejection always carries a written reason.
- All API inputs validated with Valibot; all routes carry `describeRoute`.
- Biome: double quotes, semicolons, spaces for TS/TSX. Conventional Commits.

---

### Task 1: Schema, migration, grandfathering

**Files:**
- Modify: `apps/api/src/database/schema.ts` (beside `taskTable`, ~920)
- Modify: `apps/api/src/database/index.ts` (barrel)
- Create: generated migration, with a hand-appended backfill

- [ ] **Step 1: Add the table**

```ts
export const taskAssignmentTable = pgTable(
  "task_assignment",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, { onDelete: "cascade" }),
    // Null on rows created by the grandfathering backfill: nobody recorded
    // who assigned that work, and inventing an assigner in a system that
    // notifies them would be worse than admitting we do not know.
    fromUserId: text("from_user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    toUserId: text("to_user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    // pending | accepted | rejected | superseded
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { mode: "date" }),
  },
  (table) => [
    index("task_assignment_taskId_idx").on(table.taskId),
    index("task_assignment_toUserId_idx").on(table.toUserId),
  ],
);
```

- [ ] **Step 2: Barrel and generate**

Add to `apps/api/src/database/index.ts` in its alphabetical position — `tests/api/database/schema-barrel.test.ts` fails otherwise. Then `pnpm --filter @kaneo/api db:generate`, keeping drizzle's filename and number. Never hand-edit the snapshot or the journal.

- [ ] **Step 3: Append the grandfathering backfill**

Add to the bottom of the generated migration:

```sql
--> statement-breakpoint
-- Every task already assigned when this shipped is treated as accepted.
-- Turning acceptance on retroactively would drop hundreds of prompts for
-- work already underway into people's queues. from_user_id is NULL because
-- nothing recorded who assigned these; the rejection path tolerates that.
INSERT INTO "task_assignment" ("id", "task_id", "from_user_id", "to_user_id", "status", "decided_at")
SELECT
  md5(t."id" || 'grandfathered')::text,
  t."id",
  NULL,
  t."assignee_id",
  'accepted',
  now()
FROM "task" t
WHERE t."assignee_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "task_assignment" a WHERE a."task_id" = t."id"
  );
```

The `NOT EXISTS` makes a re-run a no-op. `md5()` is core Postgres — SQL cannot call `createId()`, and this column is plain `text` with no format constraint.

- [ ] **Step 4: Verify the backfill across TWO workspaces**

A single-workspace check cannot distinguish a correct backfill from a broken one. On a fresh database: apply migrations up to the previous one, seed two workspaces each with an assigned task, apply this migration, then assert every task has exactly one `accepted` assignment row pointing at its own assignee, and that no task has more than one. Re-run the statement and confirm zero rows affected.

Paste the actual query output into your report. Tear down every container you create.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database apps/api/drizzle
git commit --no-verify -m "feat(api): task assignment lifecycle table"
```

---

### Task 2: The decision rules, as pure functions

**Files:**
- Create: `apps/api/src/task/assignment-rules.ts`
- Test: `tests/api/task/assignment-rules.test.ts`

**Interfaces:**
- Produces:
  - `assertCanDecideTask(assignment: { toUserId: string | null; status: string }, userId: string): void` — 403 unless the caller is `toUserId`; 409 if `status !== "pending"`
  - `taskAssigneeAfterDecision(decision: "accepted" | "rejected", toUserId: string | null): string | null`

- [ ] **Step 1: Write the failing test**

Create `tests/api/task/assignment-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertCanDecideTask,
  taskAssigneeAfterDecision,
} from "../../../apps/api/src/task/assignment-rules";

describe("assertCanDecideTask", () => {
  it("lets the recipient decide", () => {
    expect(() =>
      assertCanDecideTask({ toUserId: "u1", status: "pending" }, "u1"),
    ).not.toThrow();
  });

  it("refuses anyone else, including the assigner", () => {
    expect(() =>
      assertCanDecideTask({ toUserId: "u1", status: "pending" }, "boss"),
    ).toThrow();
  });

  it("refuses a decision on an assignment already decided", () => {
    for (const status of ["accepted", "rejected", "superseded"]) {
      expect(() =>
        assertCanDecideTask({ toUserId: "u1", status }, "u1"),
      ).toThrow();
    }
  });
});

describe("taskAssigneeAfterDecision", () => {
  it("makes the recipient the assignee on accept", () => {
    expect(taskAssigneeAfterDecision("accepted", "u1")).toBe("u1");
  });

  it("leaves the task unassigned on reject", () => {
    // Deliberately NOT the assigner: a lead routing twenty tasks should not
    // collect the declined ones on their own board.
    expect(taskAssigneeAfterDecision("rejected", "u1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails, implement, run again**

Create `apps/api/src/task/assignment-rules.ts`:

```ts
import { HTTPException } from "hono/http-exception";

/** Only the person the task was offered to may decide it, and only once. */
export function assertCanDecideTask(
  assignment: { toUserId: string | null; status: string },
  userId: string,
): void {
  if (!assignment.toUserId || assignment.toUserId !== userId)
    throw new HTTPException(403, {
      message: "Only the assignee can decide this task",
    });
  if (assignment.status !== "pending")
    throw new HTTPException(409, {
      message: "This assignment was already decided",
    });
}

export function taskAssigneeAfterDecision(
  decision: "accepted" | "rejected",
  toUserId: string | null,
): string | null {
  return decision === "accepted" ? toUserId : null;
}
```

Expected: PASS, 5 tests.

- [ ] **Step 3: Prove it bites**

Remove the `status !== "pending"` check and confirm the already-decided test FAILS. Restore. Then make `taskAssigneeAfterDecision` return `toUserId` unconditionally and confirm the reject test FAILS. Restore. Report both.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/task/assignment-rules.ts tests/api/task/assignment-rules.test.ts
git commit --no-verify -m "feat(api): task assignment decision rules"
```

---

### Task 3: Assignment writes pending and supersedes

**Files:**
- Modify: `apps/api/src/task/controllers/update-task-assignee.ts`
- Modify: `apps/api/src/task/controllers/create-task.ts` — assignment at creation
- Test: `tests/api-integration/task-acceptance.test.ts`

**Interfaces:**
- Consumes: `taskAssignmentTable`

- [ ] **Step 1: Change what assigning means**

In `update-task-assignee.ts` (which today writes `.set({ userId: nextAssigneeId })` at ~line 55), assigning someone **other than the caller** must instead, in one transaction:

1. Mark any existing `pending` assignment for this task as `superseded` — exactly one live prompt per task, or the dialog shows two decisions for one piece of work.
2. Insert a new assignment: `fromUserId` = the caller, `toUserId` = the new assignee, `status = 'pending'`.
3. Leave `task.userId` **unchanged**. The task is not theirs yet — that is the whole feature.

Assigning **to yourself**, or clearing the assignee, keeps today's behaviour: write `task.userId` directly, and for self-assignment insert an `accepted` row so the history is complete.

Do the same in `create-task.ts` where a task is created with an assignee.

- [ ] **Step 2: Write the integration test**

Create `tests/api-integration/task-acceptance.test.ts`. Read `tests/api-integration/correspondence-handover.test.ts` for helper patterns and `tests/api-integration/project.test.ts` for project/task fixtures. Cover:

1. Assigning to another member leaves `task.userId` null and creates a `pending` row.
2. Assigning to yourself sets `task.userId` immediately and creates an `accepted` row — no prompt.
3. Reassigning while one is pending supersedes the first; exactly one `pending` row remains.
4. Clearing the assignee supersedes any pending assignment and leaves `task.userId` null.

Real arrangements and assertions. A comments-only test body is a task failure.

- [ ] **Step 3: Run, then commit**

Start PostgreSQL, run the API and integration suites, report totals, tear down.

```bash
git add apps/api/src/task tests/api-integration/task-acceptance.test.ts
git commit --no-verify -m "feat(api): assigning a task offers it rather than granting it"
```

---

### Task 4: The provider, and rejection's notification

**Files:**
- Create: `apps/api/src/pending-decision/providers/task.ts`
- Modify: `apps/api/src/pending-decision/registry.ts`
- Test: `tests/api/pending-decision/task-provider.test.ts`, extend `tests/api-integration/task-acceptance.test.ts`

**Interfaces:**
- Consumes: `assertCanDecideTask`, `taskAssigneeAfterDecision` from Task 2
- Produces: `taskProvider: PendingDecisionProvider` with `source: "task"`; `toPendingItem(row)` exported pure

- [ ] **Step 1: Write the failing mapper test**

Create `tests/api/pending-decision/task-provider.test.ts`, testing the pure mapper only:

```ts
import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/task";

const row = {
  id: "a1",
  taskId: "t1",
  title: "Fix the export",
  taskNumber: 42,
  projectName: "Platform",
  projectSlug: "platform",
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("task toPendingItem", () => {
  it("identifies the task, not the assignment row", () => {
    const item = toPendingItem(row);
    expect(item.source).toBe("task");
    expect(item.subtitle).toBe("Fix the export");
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row).requiresReason).toBe(true);
  });

  it("names the project so the reader knows whose work this is", () => {
    expect(toPendingItem(row).context.join(" ")).toContain("Platform");
  });
});
```

- [ ] **Step 2: Run to verify it fails, then build the provider**

Create `apps/api/src/pending-decision/providers/task.ts`, mirroring `providers/correspondence.ts`.

`list` selects `pending` assignments where `toUserId = userId`, joined to the task and project, scoped to the workspace — **and only for projects the user can access**. Use `getMemberProjectIds` / `isGlobalAdmin` from `apps/api/src/utils/project-access.ts`, the same pair the project list uses. A task in a project you were removed from must not appear as a decision you can make.

`decide` loads the assignment scoped to the workspace, calls `assertCanDecideTask`, and in one transaction sets the assignment's `status` and `decidedAt`, writes `task.userId` from `taskAssigneeAfterDecision`, and stores the reason on reject. Guard the transaction's update with `status = 'pending'` as its predicate so a racing second decision claims nothing — mirror `decideLetterAssignment`.

On reject, notify `fromUserId` — **and skip the notification entirely when it is null.** Grandfathered rows have no assigner; the rejection must still unassign the task.

Reject with an empty or whitespace-only reason throws `HTTPException(400)` before any write.

Register in `registry.ts`.

- [ ] **Step 3: Extend the integration test**

Add to `tests/api-integration/task-acceptance.test.ts`:

5. Accepting sets `task.userId` to the accepter and the assignment to `accepted`.
6. Rejecting with a reason leaves `task.userId` null, sets `rejected`, stores the reason, and notifies the assigner.
7. Rejecting an assignment whose `fromUserId` is null still unassigns the task and does not error.
8. Rejecting with an empty reason returns 400 and changes nothing.
9. A second decision returns 409.
10. A pending assignment for a project the user is not a member of is not listed.

Case 7 is the grandfathered-row case and the one most likely to be skipped.

- [ ] **Step 4: Run and commit**

```bash
git add apps/api/src/pending-decision tests
git commit --no-verify -m "feat(api): task acceptance through the pending-decision registry"
```

---

### Task 5: Pending tasks leave the work queues

**Files:**
- Modify: `apps/api/src/task/controllers/get-my-tasks.ts`
- Test: extend `tests/api-integration/task-acceptance.test.ts`

**Why this task is separate:** everything above is bookkeeping until the rest of the app stops treating a pending task as assigned. This is the task that makes the feature real.

- [ ] **Step 1: Exclude pending tasks from "my tasks"**

`get-my-tasks.ts` filters on `taskTable.userId`. Because assignment no longer writes `userId` until acceptance, a pending task is *already* excluded — verify that by reading the query rather than assuming, and say in your report which it is.

If it is already correct, add nothing but the test. If some other path writes `userId` early, fix that path rather than filtering here.

- [ ] **Step 2: Add the test that proves it**

Add to `tests/api-integration/task-acceptance.test.ts`:

11. A task with a pending assignment does **not** appear in the assignee's `GET /task/my-tasks`, and does appear once accepted.

This is the single most important test in the plan. Without it the feature is decoration.

- [ ] **Step 3: Prove it bites**

Temporarily make assignment write `task.userId` immediately, confirm test 11 FAILS, restore. Report the observation verbatim.

- [ ] **Step 4: Run and commit**

```bash
git add apps/api/src/task tests/api-integration/task-acceptance.test.ts
git commit --no-verify -m "test(api): pending tasks stay out of my-tasks"
```

---

### Task 6: Web surface

**Files:**
- Modify: `apps/web/src/fetchers/task/*` and the task types — a task gains `pendingAssigneeName: string | null`
- Modify: the task card / detail component that shows the assignee
- Test: whichever test file already covers that component; otherwise state that only the build typechecks it

- [ ] **Step 1: Surface the pending state**

A task with a pending assignment currently looks simply unassigned, which is true but unhelpful — a lead cannot tell "nobody has this" from "someone was asked an hour ago". Return the pending assignee's name from the task read path and render it as "Awaiting <name>" where the assignee would appear.

Do not render it as the assignee. The task is not theirs.

- [ ] **Step 2: The dialog needs nothing**

The accept/reject dialog, chime, toast and dot render whatever the registry returns. Confirm by reading `apps/web/src/components/pending-decision-dialog.tsx` that no change is needed and say so. If one is needed, report it rather than editing the shared component.

- [ ] **Step 3: Run and commit**

`pnpm --filter @kaneo/web test` and `pnpm --filter @kaneo/web build`. Report both, and whether you ran the app.

```bash
git add apps/web/src
git commit --no-verify -m "feat(web): show tasks awaiting acceptance"
```

---

### Task 7: Full verification

**Files:** none — runs only.

- [ ] **Step 1: Start PostgreSQL and run everything**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

```bash
pnpm test
pnpm --filter @kaneo/web build
cd apps/api && npx vitest run --config vitest.integration.config.ts
```

- [ ] **Step 2: Re-verify the grandfathering with two workspaces**

Repeat Task 1 Step 4 against the final code, not the code as it was when the migration was written. Paste the query output.

- [ ] **Step 3: Tear down and report**

`docker rm -f kaneo-test-pg`, even on failure. Report every total. BLOCKED with exact output if anything failed.

---

## Browser verification

1. Assign a task to a colleague. Your board still shows it unassigned; their dialog pops with the task title and project.
2. They accept. It becomes theirs on both boards and appears in their "my tasks".
3. Assign another and have them reject it with a reason. It returns to unassigned, and you are notified with the reason — it does not appear on your board.
4. Assign a task to yourself. No prompt.
5. Reassign a task that is already awaiting someone. The first person's prompt disappears; only the new one is live.
