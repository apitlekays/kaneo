# Bilateral Letter Handover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No user becomes a letter's Main User without accepting the assignment, and they learn of it immediately through a toast, a chime, and a dot on Home.

**Architecture:** `letter_assignment.status` already holds `pending | accepted | rejected | done` but nothing advances it. Assignment stops writing `letter.currentAssigneeId`; new accept/reject endpoints do. Delivery reuses the existing user-scoped WebSocket (`broadcastToUser`), which triggers a refetch that the client turns into a toast.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, Valibot, Vitest (unit + integration), React 19, TanStack Query, sonner.

**Spec:** `docs/superpowers/specs/2026-08-18-bilateral-letter-handover-design.md`

## Global Constraints

- No schema change and no migration. `letter_assignment.status` is a plain `text` column; `superseded` needs no enum change.
- `"disposed"` and other letter statuses stay out of the `STATUSES` array unless a task says otherwise.
- Departmental assignment gets no UI. `toDeptId` stays in the API and stays unused.
- Letters that already hold a `currentAssigneeId` count as accepted. Never retroactively unassign live work.
- Only the named recipient may accept or reject.
- Correspondence routes are gated by `requireWorkspacePageAccess("general-management")`. In integration tests, grant it with a `workspace_page_access` row or use a workspace `owner` (global admins bypass the check).
- Run `pnpm test` (unit) and `pnpm test:integration` (needs PostgreSQL) before each commit. Start a database with:
  `docker run -d --name kaneo-itest-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine`
  then `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kaneo_test" pnpm test:integration`.

---

### Task 1: Assignment decision rules

**Files:**
- Create: `apps/api/src/correspondence/assignment-rules.ts`
- Test: `tests/api/correspondence/assignment-rules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AssignmentDecision = "accepted" | "rejected"`
  - `assertCanDecide(assignment: {toUserId: string | null; status: string}, userId: string): void` — throws `HTTPException(403 | 409)`
  - `ownerAfterDecision(assignment: {toUserId: string | null; fromUserId: string | null}, decision: AssignmentDecision): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/correspondence/assignment-rules.test.ts
import { describe, expect, it } from "vitest";
import {
  assertCanDecide,
  ownerAfterDecision,
} from "../../../apps/api/src/correspondence/assignment-rules";

const pending = { toUserId: "siti", fromUserId: "ahmad", status: "pending" };

describe("assertCanDecide", () => {
  it("lets the named recipient decide", () => {
    expect(() => assertCanDecide(pending, "siti")).not.toThrow();
  });

  it("refuses anyone who is not the named recipient", () => {
    expect(() => assertCanDecide(pending, "ahmad")).toThrowError(
      /only the assigned recipient/i,
    );
  });

  it("refuses a second decision on an already-decided assignment", () => {
    expect(() =>
      assertCanDecide({ ...pending, status: "accepted" }, "siti"),
    ).toThrowError(/already/i);
  });

  it("refuses a superseded assignment", () => {
    expect(() =>
      assertCanDecide({ ...pending, status: "superseded" }, "siti"),
    ).toThrowError(/already/i);
  });
});

describe("ownerAfterDecision", () => {
  it("hands the letter to the recipient on accept", () => {
    expect(ownerAfterDecision(pending, "accepted")).toBe("siti");
  });

  it("returns the letter to the sender on reject", () => {
    expect(ownerAfterDecision(pending, "rejected")).toBe("ahmad");
  });

  it("leaves the letter unowned when a rejected assignment has no sender", () => {
    // fromUserId is nullable: the sending user may have been deleted.
    expect(
      ownerAfterDecision({ toUserId: "siti", fromUserId: null }, "rejected"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/assignment-rules.test.ts`
Expected: FAIL — cannot resolve `./assignment-rules`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/correspondence/assignment-rules.ts
import { HTTPException } from "hono/http-exception";

export type AssignmentDecision = "accepted" | "rejected";

/** A handover is two-sided: only the named recipient may answer, and only once. */
export function assertCanDecide(
  assignment: { toUserId: string | null; status: string },
  userId: string,
): void {
  if (assignment.toUserId !== userId) {
    throw new HTTPException(403, {
      message: "Only the assigned recipient can accept or reject this letter",
    });
  }
  if (assignment.status !== "pending") {
    throw new HTTPException(409, {
      message: `This assignment was already ${assignment.status}`,
    });
  }
}

/** Accept moves the letter to the recipient; reject returns it to the sender. */
export function ownerAfterDecision(
  assignment: { toUserId: string | null; fromUserId: string | null },
  decision: AssignmentDecision,
): string | null {
  return decision === "accepted" ? assignment.toUserId : assignment.fromUserId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/assignment-rules.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/correspondence/assignment-rules.ts tests/api/correspondence/assignment-rules.test.ts
git commit -m "feat(correspondence): assignment accept/reject decision rules"
```

---

### Task 2: A correspondence fixture for integration tests

**Files:**
- Modify: `tests/api-integration/helpers/fixtures.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createGmMember(overrides?: { role?: string }): Promise<SeededMemberContext>` — a workspace member who also holds `general-management` page access.

There are no correspondence integration tests yet. Every later task needs this, so build it once here.

- [ ] **Step 1: Add the fixture**

```ts
// tests/api-integration/helpers/fixtures.ts — append
import { workspacePageAccessTable } from "../../../apps/api/src/database/schema";

/**
 * Correspondence routes run requireWorkspacePageAccess("general-management").
 * A plain member is refused, so grant the page explicitly.
 */
export async function grantGeneralManagement(
  workspaceId: string,
  userId: string,
) {
  await db.insert(workspacePageAccessTable).values({
    workspaceId,
    userId,
    pageSlug: "general-management",
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @kaneo/api build`
Expected: no TypeScript errors. If `workspacePageAccessTable` is not exported from the barrel, import it from `../../../apps/api/src/database/schema` as shown.

- [ ] **Step 3: Commit**

```bash
git add tests/api-integration/helpers/fixtures.ts
git commit -m "test(correspondence): fixture granting general-management page access"
```

---

### Task 3: Assignment stops transferring ownership

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts:549` (capture) and the route handler near `:846`
- Test: `tests/api-integration/correspondence-handover.test.ts`

**Interfaces:**
- Consumes: `grantGeneralManagement` (Task 2).
- Produces: the invariant that `letter.currentAssigneeId` is null until an assignment is accepted.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api-integration/correspondence-handover.test.ts
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, grantGeneralManagement } from "./helpers/fixtures";

async function captureLetter(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  assigneeId?: string,
) {
  const response = await app.request("/api/correspondence/letters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject: "Ujian serah tugas",
      assigneeId,
    }),
  });
  return response;
}

describe("API integration: bilateral handover", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("leaves a letter unowned until the assignee accepts", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    // Put the clerk in the officer's workspace.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const response = await captureLetter(
      app,
      officer.workspace.id,
      clerk.user.id,
    );
    expect(response.status).toBe(201);
    const letter = await response.json();

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, letter.id));
    expect(row.currentAssigneeId).toBeNull();
    expect(row.status).toBe("captured");

    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, letter.id));
    expect(assignment.toUserId).toBe(clerk.user.id);
    expect(assignment.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kaneo_test" pnpm --filter @kaneo/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/correspondence-handover.test.ts`
Expected: FAIL — `expected 'clerk-id' to be null`, because capture still writes `currentAssigneeId`.

- [ ] **Step 3: Stop writing the owner at capture**

In `apps/api/src/correspondence/letters.ts`, inside the capture insert (around line 549), change:

```ts
              status: "captured",
              currentAssigneeId: assigneeId,
              createdBy: userId,
```

to:

```ts
              status: "captured",
              // Ownership transfers only when the assignee accepts.
              currentAssigneeId: null,
              createdBy: userId,
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Add the route test**

```ts
// append inside the same describe block
  it("keeps the letter with the sender until the new assignee accepts", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();

    const created = await (await captureLetter(app, officer.workspace.id)).json();

    // Give it an owner directly, standing in for an accepted first assignment.
    await db
      .update(schema.letterTable)
      .set({ currentAssigneeId: officer.user.id })
      .where(eq(schema.letterTable.id, created.id));

    const other = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: other.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const routed = await app.request(
      `/api/correspondence/letters/${created.id}/route`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          toUserId: other.user.id,
          action: "inspect",
        }),
      },
    );
    expect(routed.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.currentAssigneeId).toBe(officer.user.id);
  });

  it("supersedes an open pending assignment when the letter is routed again", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const first = await createWorkspaceMember({ role: "member" });
    const second = await createWorkspaceMember({ role: "member" });
    for (const u of [first, second]) {
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: officer.workspace.id,
        userId: u.user.id,
        role: "member",
        joinedAt: new Date(),
      });
    }
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, first.user.id)
    ).json();

    await app.request(`/api/correspondence/letters/${created.id}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: officer.workspace.id,
        toUserId: second.user.id,
      }),
    });

    const rows = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));
    const forFirst = rows.find((r) => r.toUserId === first.user.id);
    const forSecond = rows.find((r) => r.toUserId === second.user.id);
    expect(forFirst?.status).toBe("superseded");
    expect(forSecond?.status).toBe("pending");
  });
```

- [ ] **Step 6: Run to verify the new tests fail**

Expected: the route test passes already (route sets `currentAssigneeId` to the new user, not the sender — no, it fails: it sets it to `other.user.id`). The supersede test fails because nothing writes `superseded`.

- [ ] **Step 7: Change the route handler**

In the route handler (around line 840), replace the letter update and add supersession inside the same transaction, before the insert:

```ts
        const result = await db.transaction(async (tx) => {
          // A recipient who is bypassed must not keep a stale pending item.
          await tx
            .update(letterAssignmentTable)
            .set({ status: "superseded", decidedAt: new Date() })
            .where(
              and(
                eq(letterAssignmentTable.letterId, id),
                eq(letterAssignmentTable.status, "pending"),
              ),
            );
          const [assignment] = await tx
            .insert(letterAssignmentTable)
            .values({
              letterId: id,
              fromUserId: userId,
              toUserId: b.toUserId ?? null,
              toDeptId: b.toDeptId ?? null,
              action: b.action ?? null,
              note: b.note ?? null,
              dueAt: toDate(b.dueAt),
              status: "pending",
            })
            .returning();
```

and change the letter update in the same transaction to leave ownership alone:

```ts
          const [row] = await tx
            .update(letterTable)
            .set({
              // currentAssigneeId is unchanged: the handover is not complete
              // until the recipient accepts.
              updatedAt: new Date(),
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
```

- [ ] **Step 8: Run all three tests**

Expected: PASS.

- [ ] **Step 9: Run the whole suite**

Run: `pnpm test` and the integration command from Global Constraints.
Expected: all green. If an existing test asserted that routing changes the owner, update it — that behaviour is intentionally gone.

- [ ] **Step 10: Reconcile assignments written before this change**

Every existing `letter_assignment` row was written `pending` and never advanced,
while its letter already has a `currentAssigneeId`. Without this step those rows
would appear as pending work in the recipient's Home feed and in the GM
watchlist for letters that are already owned and being worked on.

The spec's rule is that a letter already holding a `currentAssigneeId` counts as
accepted. Add a data-only migration — no schema change — as
`apps/api/drizzle/0053_accept_existing_assignments.sql`:

```sql
-- Assignments predating bilateral handover: the letter is already owned by the
-- assignee, so the handover plainly happened. Mark them accepted so they do not
-- resurface as pending work.
UPDATE letter_assignment a
SET status = 'accepted',
    decided_at = COALESCE(a.decided_at, a.created_at)
FROM letter l
WHERE a.letter_id = l.id
  AND a.status = 'pending'
  AND l.current_assignee_id IS NOT NULL
  AND l.current_assignee_id = a.to_user_id;
```

Confirm the file is picked up: migrations auto-run on API startup from
`apps/api/drizzle/`. Check the journal file in that directory and follow its
existing naming and registration convention exactly — if entries are tracked in
`meta/_journal.json`, add this migration there too, or it will be skipped.

- [ ] **Step 11: Verify the backfill**

Run the integration suite. Then, against a scratch database, insert a letter
with `current_assignee_id` set and a `pending` assignment to that same user, run
the migration, and confirm the row reads `accepted`. Rows whose `to_user_id`
differs from the letter's owner must stay `pending` — those are genuine
in-flight handovers.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/correspondence/letters.ts apps/api/drizzle tests/api-integration/correspondence-handover.test.ts
git commit -m "feat(correspondence): assignment no longer transfers ownership on its own"
```

---

### Task 4: Accept and reject endpoints

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` (add two routes after the route handler)
- Test: `tests/api-integration/correspondence-handover.test.ts`

**Interfaces:**
- Consumes: `assertCanDecide`, `ownerAfterDecision` (Task 1).
- Produces: `POST /letters/:id/assignments/:aid/accept` and `.../reject`, both returning the updated letter row.

- [ ] **Step 1: Write the failing tests**

```ts
// append inside the same describe block
  it("transfers ownership when the recipient accepts", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const accepted = await clerkApp.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: officer.workspace.id }),
      },
    );
    expect(accepted.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.currentAssigneeId).toBe(clerk.user.id);
    expect(row.status).toBe("assigned");
  });

  it("returns the letter to the sender when the recipient rejects", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    await clerkApp.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          note: "Bukan bidang saya",
        }),
      },
    );

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.currentAssigneeId).toBe(officer.user.id);
  });

  it("refuses a decision from anyone but the named recipient", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    // The officer is the sender, not the recipient.
    const response = await app.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: officer.workspace.id }),
      },
    );
    expect(response.status).toBe(403);
  });
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL with 404 — the routes do not exist.

- [ ] **Step 3: Add the endpoints**

Add after the route handler in `apps/api/src/correspondence/letters.ts`, and import the rules at the top:

```ts
import {
  type AssignmentDecision,
  assertCanDecide,
  ownerAfterDecision,
} from "./assignment-rules";
```

```ts
    // ── Accept / reject a pending assignment ─────────────────────────────────
    .post(
      "/letters/:id/assignments/:aid/accept",
      validator("param", v.object({ id: v.string(), aid: v.string() })),
      validator("json", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      async (c) => decideAssignment(c, "accepted"),
    )
    .post(
      "/letters/:id/assignments/:aid/reject",
      validator("param", v.object({ id: v.string(), aid: v.string() })),
      validator(
        "json",
        v.object({ workspaceId: v.string(), note: optStr }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      async (c) => decideAssignment(c, "rejected"),
    )
```

Note there is no `pageAccess` on these two routes on purpose: a recipient who
has not yet accepted may not hold the General Management page, but must still be
able to answer. The `assertCanDecide` check restricts them to their own
assignment, which is a tighter guard than the page.

Add the shared handler above `registerLetterRoutes`:

```ts
async function decideAssignment(c: Context, decision: AssignmentDecision) {
  const ws = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const { id, aid } = c.req.param();
  const note = decision === "rejected" ? await readNote(c) : null;

  const [assignment] = await db
    .select()
    .from(letterAssignmentTable)
    .where(
      and(
        eq(letterAssignmentTable.id, aid),
        eq(letterAssignmentTable.letterId, id),
      ),
    )
    .limit(1);
  if (!assignment) throw new HTTPException(404, { message: "Not found" });
  assertCanDecide(assignment, userId);

  const owner = ownerAfterDecision(assignment, decision);
  const decidedAt = new Date();

  const updated = await db.transaction(async (tx) => {
    await tx
      .update(letterAssignmentTable)
      .set({ status: decision, decidedAt, note: note ?? assignment.note })
      .where(eq(letterAssignmentTable.id, aid));
    const [row] = await tx
      .update(letterTable)
      .set({
        currentAssigneeId: owner,
        status: "assigned",
        updatedAt: decidedAt,
      })
      .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
      .returning();
    await recordAuditEvent(tx, {
      workspaceId: ws,
      entityType: "letter",
      entityId: id,
      action: decision === "accepted" ? "accept" : "reject",
      actorId: userId,
      after: { assignmentId: aid, note },
      ip: getIp(c),
    });
    return row;
  });
  return c.json(updated);
}

async function readNote(c: Context): Promise<string | null> {
  const body = (await c.req.json().catch(() => ({}))) as { note?: string };
  return body.note?.trim() || null;
}
```

- [ ] **Step 4: Run to verify they pass**

Expected: PASS — all six handover tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/correspondence/letters.ts tests/api-integration/correspondence-handover.test.ts
git commit -m "feat(correspondence): accept and reject a pending assignment"
```

---

### Task 5: Pending assignments in the Home feed and a GM watchlist

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` (my-correspondence query; new list route)
- Modify: `apps/web/src/fetchers/correspondence/letters.ts` (types + fetcher)
- Test: `tests/api-integration/correspondence-handover.test.ts`

**Interfaces:**
- Consumes: Task 4's endpoints.
- Produces:
  - `my-correspondence` response gains `pendingAssignments: { id, letterId, refNo, subject, action, note, createdAt }[]`
  - `GET /letters/awaiting-acceptance?workspaceId=` returning the same shape for the whole workspace
  - Web type `MyCorrespondence.pendingAssignments` and `getAwaitingAcceptance(workspaceId)`

- [ ] **Step 1: Write the failing test**

```ts
  it("lists a pending assignment for its recipient", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    await captureLetter(app, officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const response = await clerkApp.request(
      `/api/correspondence/my-correspondence?workspaceId=${officer.workspace.id}`,
    );
    const body = await response.json();
    expect(body.pendingAssignments).toHaveLength(1);
    expect(body.pendingAssignments[0].subject).toBe("Ujian serah tugas");
  });
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — `expected undefined to have length 1`.

- [ ] **Step 3: Add the query to my-correspondence**

Inside the `/my-correspondence` handler, after the existing `actions` query:

```ts
        const pendingAssignments = await db
          .select({
            id: letterAssignmentTable.id,
            letterId: letterAssignmentTable.letterId,
            action: letterAssignmentTable.action,
            note: letterAssignmentTable.note,
            createdAt: letterAssignmentTable.createdAt,
            refNo: letterTable.refNo,
            subject: letterTable.subject,
          })
          .from(letterAssignmentTable)
          .innerJoin(
            letterTable,
            eq(letterAssignmentTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterAssignmentTable.toUserId, userId),
              eq(letterAssignmentTable.status, "pending"),
            ),
          )
          .orderBy(desc(letterAssignmentTable.createdAt));
```

and add `pendingAssignments` to the JSON returned by that handler.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS.

- [ ] **Step 5: Add the GM watchlist route**

```ts
    .get(
      "/letters/awaiting-acceptance",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const rows = await db
          .select({
            id: letterAssignmentTable.id,
            letterId: letterAssignmentTable.letterId,
            toUserId: letterAssignmentTable.toUserId,
            action: letterAssignmentTable.action,
            createdAt: letterAssignmentTable.createdAt,
            refNo: letterTable.refNo,
            subject: letterTable.subject,
          })
          .from(letterAssignmentTable)
          .innerJoin(
            letterTable,
            eq(letterAssignmentTable.letterId, letterTable.id),
          )
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterAssignmentTable.status, "pending"),
            ),
          )
          .orderBy(asc(letterAssignmentTable.createdAt));
        return c.json(rows);
      },
    )
```

Register it **before** `/letters/:id` so `awaiting-acceptance` is not captured as an id.

- [ ] **Step 6: Extend the web types**

```ts
// apps/web/src/fetchers/correspondence/letters.ts
export type PendingAssignment = {
  id: string;
  letterId: string;
  refNo: string | null;
  subject: string;
  action: string | null;
  note: string | null;
  createdAt: string;
};

// add to MyCorrespondence:
//   pendingAssignments: PendingAssignment[];

export const acceptAssignment = (
  workspaceId: string,
  letterId: string,
  assignmentId: string,
) =>
  post<Letter>(
    `letters/${letterId}/assignments/${assignmentId}/accept`,
    workspaceId,
    {},
  );

export const rejectAssignment = (
  workspaceId: string,
  letterId: string,
  assignmentId: string,
  note?: string,
) =>
  post<Letter>(
    `letters/${letterId}/assignments/${assignmentId}/reject`,
    workspaceId,
    { note },
  );

export async function getAwaitingAcceptance(
  workspaceId: string,
): Promise<(PendingAssignment & { toUserId: string | null })[]> {
  return jsonOrThrow(
    await fetch(
      url(`letters/awaiting-acceptance?workspaceId=${workspaceId}`),
      { credentials: "include" },
    ),
  );
}
```

Match the existing `post` helper's signature in that file; if it differs, follow the file's convention rather than this sketch.

- [ ] **Step 7: Run the full suite**

Run: `pnpm test` plus the integration command.
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/correspondence/letters.ts apps/web/src/fetchers/correspondence/letters.ts tests/api-integration/correspondence-handover.test.ts
git commit -m "feat(correspondence): expose pending assignments and a GM watchlist"
```

---

### Task 6: Broadcast assignment events to the recipient

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts` (capture, route, decideAssignment)

**Interfaces:**
- Consumes: `broadcastToUser(userId, { entity })` from `apps/api/src/ws`.
- Produces: a `USER_SYNC` message with `entity: "letter-assignment"` whenever a user's pending list changes.

- [ ] **Step 1: Add the broadcasts**

Import at the top of `letters.ts`:

```ts
import { broadcastToUser } from "../ws";
```

Call it in three places, each after the transaction commits so a rolled-back write never notifies:

```ts
// capture, next to the existing notifyAssigned call
if (assigneeId) broadcastToUser(assigneeId, { entity: "letter-assignment" });

// route, next to the existing notifyAssigned call
if (b.toUserId) broadcastToUser(b.toUserId, { entity: "letter-assignment" });

// decideAssignment, after the transaction
if (assignment.toUserId)
  broadcastToUser(assignment.toUserId, { entity: "letter-assignment" });
if (decision === "rejected" && assignment.fromUserId)
  broadcastToUser(assignment.fromUserId, { entity: "letter-assignment" });
```

Confirm the exact import path by checking how `apps/api/src/ws/index.ts` is imported elsewhere in the codebase.

- [ ] **Step 2: Verify the build and suite**

Run: `pnpm build` then `pnpm test`.
Expected: green. Broadcasting is fire-and-forget and has no test of its own; Task 8 exercises the client side.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/correspondence/letters.ts
git commit -m "feat(correspondence): notify assignees over the user socket"
```

---

### Task 7: Chime playback and its per-device preference

**Files:**
- Create: `apps/web/src/lib/play-chime.ts`
- Create: `apps/web/src/hooks/use-chime-preference.ts`
- Test: `apps/web/src/lib/play-chime.test.ts`
- Asset: `apps/web/public/chime.mp3` (a short, quiet notification tone under 30 KB)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createChime(options: { isMuted: () => boolean; audio: { play: () => Promise<void> } }): { play: () => void; unlock: () => void }`
  - `useChimePreference(): { muted: boolean; setMuted: (v: boolean) => void }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/play-chime.test.ts
import { describe, expect, it, vi } from "vitest";
import { createChime } from "./play-chime";

function fakeAudio() {
  const play = vi.fn().mockResolvedValue(undefined);
  return { play };
}

describe("createChime", () => {
  it("plays when not muted", () => {
    const audio = fakeAudio();
    createChime({ isMuted: () => false, audio }).play();
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("stays silent when muted", () => {
    const audio = fakeAudio();
    createChime({ isMuted: () => true, audio }).play();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("swallows a rejected play so a blocked autoplay never breaks the caller", async () => {
    const audio = { play: vi.fn().mockRejectedValue(new Error("blocked")) };
    const chime = createChime({ isMuted: () => false, audio });
    expect(() => chime.play()).not.toThrow();
    await Promise.resolve();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run --config vitest.config.ts src/lib/play-chime.test.ts`
Expected: FAIL — cannot resolve `./play-chime`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/play-chime.ts
type ChimeAudio = { play: () => Promise<void> };

/**
 * Browsers suppress audio until the user has interacted with the page, so a
 * rejected play is expected and must never surface as an error.
 */
export function createChime(options: {
  isMuted: () => boolean;
  audio: ChimeAudio;
}) {
  return {
    play() {
      if (options.isMuted()) return;
      void options.audio.play().catch(() => {});
    },
    unlock() {
      void options.audio.play().catch(() => {});
    },
  };
}
```

```ts
// apps/web/src/hooks/use-chime-preference.ts
import { useCallback, useState } from "react";

const KEY = "kaneo.correspondence.chimeMuted";

/** Sound is a per-device concern: muted at the office, audible at home. */
export function useChimePreference() {
  const [muted, setMutedState] = useState(
    () => localStorage.getItem(KEY) === "true",
  );
  const setMuted = useCallback((value: boolean) => {
    localStorage.setItem(KEY, String(value));
    setMutedState(value);
  }, []);
  return { muted, setMuted };
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/play-chime.ts apps/web/src/lib/play-chime.test.ts apps/web/src/hooks/use-chime-preference.ts apps/web/public/chime.mp3
git commit -m "feat(web): chime playback with a per-device mute"
```

---

### Task 8: Alert on genuinely new assignments

**Files:**
- Create: `apps/web/src/hooks/use-assignment-alerts.ts`
- Test: `apps/web/src/hooks/use-assignment-alerts.test.ts`

**Interfaces:**
- Consumes: `PendingAssignment` (Task 5), `createChime` (Task 7).
- Produces: `newAssignmentIds(seen: Set<string>, pending: {id: string}[]): string[]` and the `useAssignmentAlerts(pending, handlers)` hook.

The risk here is replay: a reconnect or refetch must not re-announce assignments the user has already seen. Test that first.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/hooks/use-assignment-alerts.test.ts
import { describe, expect, it } from "vitest";
import { newAssignmentIds } from "./use-assignment-alerts";

describe("newAssignmentIds", () => {
  it("reports an assignment the user has not seen", () => {
    expect(newAssignmentIds(new Set(["a"]), [{ id: "a" }, { id: "b" }])).toEqual(
      ["b"],
    );
  });

  it("reports nothing when everything is already seen", () => {
    // A refetch or socket reconnect must not replay old alerts.
    expect(newAssignmentIds(new Set(["a", "b"]), [{ id: "a" }, { id: "b" }])).toEqual(
      [],
    );
  });

  it("reports nothing for an empty list", () => {
    expect(newAssignmentIds(new Set(), [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run --config vitest.config.ts src/hooks/use-assignment-alerts.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/hooks/use-assignment-alerts.ts
import { useEffect, useRef } from "react";
import type { PendingAssignment } from "@/fetchers/correspondence/letters";

export function newAssignmentIds(
  seen: Set<string>,
  pending: { id: string }[],
): string[] {
  return pending.filter((p) => !seen.has(p.id)).map((p) => p.id);
}

/**
 * Announces assignments the user has not seen. The seen set is seeded from the
 * first list received, so a page load or socket reconnect stays silent and only
 * genuinely new work interrupts anyone.
 */
export function useAssignmentAlerts(
  pending: PendingAssignment[] | undefined,
  onNew: (assignment: PendingAssignment) => void,
) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!pending) return;
    if (seen.current === null) {
      seen.current = new Set(pending.map((p) => p.id));
      return;
    }
    for (const id of newAssignmentIds(seen.current, pending)) {
      const item = pending.find((p) => p.id === id);
      seen.current.add(id);
      if (item) onNew(item);
    }
  }, [pending, onNew]);
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-assignment-alerts.ts apps/web/src/hooks/use-assignment-alerts.test.ts
git commit -m "feat(web): announce only assignments the user has not seen"
```

---

### Task 9: Wire the toast and chime into the app shell

**Files:**
- Modify: `apps/web/src/hooks/use-user-websocket.ts` (invalidate on the new entity)
- Create: `apps/web/src/components/correspondence-alerts.tsx`
- Modify: the authenticated layout that already mounts `useUserWebSocket`

**Interfaces:**
- Consumes: `useMyCorrespondence`, `useAssignmentAlerts`, `createChime`, `useChimePreference`.
- Produces: a mounted component with no props that raises toasts.

- [ ] **Step 1: Invalidate on the new entity**

In `use-user-websocket.ts`, where `USER_SYNC` is handled, ensure the `entity` value `"letter-assignment"` invalidates the `my-correspondence` query key. Follow the file's existing invalidation pattern rather than inventing one.

- [ ] **Step 2: Create the component**

```tsx
// apps/web/src/components/correspondence-alerts.tsx
import { useCallback, useMemo } from "react";
import { useMyCorrespondence } from "@/hooks/queries/correspondence/use-letters";
import { useAssignmentAlerts } from "@/hooks/use-assignment-alerts";
import { useChimePreference } from "@/hooks/use-chime-preference";
import { createChime } from "@/lib/play-chime";
import { toast } from "@/lib/toast";

export function CorrespondenceAlerts({ workspaceId }: { workspaceId: string }) {
  const { data } = useMyCorrespondence(workspaceId);
  const { muted } = useChimePreference();

  const chime = useMemo(
    () =>
      createChime({
        isMuted: () => muted,
        audio: new Audio("/chime.mp3"),
      }),
    [muted],
  );

  const onNew = useCallback(
    (assignment: { refNo: string | null; subject: string }) => {
      chime.play();
      toast.info(
        `New correspondence: ${assignment.refNo ?? assignment.subject}`,
      );
    },
    [chime],
  );

  useAssignmentAlerts(data?.pendingAssignments, onNew);
  return null;
}
```

- [ ] **Step 3: Mount it**

Mount `<CorrespondenceAlerts workspaceId={workspace.id} />` in the same authenticated layout that calls `useUserWebSocket()`, guarded so it renders only when a workspace is selected.

- [ ] **Step 4: Verify by hand**

Run `pnpm dev`. In two browsers signed in as different users, register a letter assigning it to the second user. The second browser should show a toast within a second or two and play the chime, provided that browser has been clicked at least once.

- [ ] **Step 5: Run the suite and commit**

```bash
pnpm test && pnpm build
git add apps/web/src
git commit -m "feat(web): toast and chime when correspondence is assigned"
```

---

### Task 10: Accept and reject in the letter dialog

**Files:**
- Modify: `apps/web/src/components/general-management/letter-detail-dialog.tsx`

**Interfaces:**
- Consumes: `acceptAssignment`, `rejectAssignment` (Task 5).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add a pending banner to the overview**

At the top of `OverviewSection`, when the letter has a pending assignment addressed to the current user, render a banner above the fields:

```tsx
{pendingForMe && (
  <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
    <span className="text-sm">
      You have been assigned this letter. Accept to become its Main User.
    </span>
    <span className="flex gap-2">
      <Button size="sm" onClick={() => accept(pendingForMe.id)}>
        Accept
      </Button>
      <Button size="sm" variant="outline" onClick={() => openReject(pendingForMe)}>
        Reject
      </Button>
    </span>
  </div>
)}
```

Reject opens a small prompt for a reason, then calls `rejectAssignment`. Both invalidate `["letter", workspaceId, letter.id]` and `["my-correspondence", workspaceId]` on success, and surface failures with `toast.error`.

The letter payload must include the pending assignment. If `getLetter` does not already return assignments with their status, extend it in this task and note the change.

- [ ] **Step 2: Verify by hand**

Register a letter assigned to a second user, open it as that user, accept it, and confirm the banner disappears and the Main User is set. Repeat with reject and confirm the letter returns to the sender.

- [ ] **Step 3: Run the suite and commit**

```bash
pnpm test && pnpm build
git add apps/web/src/components/general-management/letter-detail-dialog.tsx
git commit -m "feat(correspondence): accept or reject an assignment from the letter"
```

---

### Task 11: The dot on Home and the GM watchlist view

**Files:**
- Modify: `apps/web/src/components/nav-main.tsx:36`
- Modify: `apps/web/src/components/general-management/correspondence.tsx`

**Interfaces:**
- Consumes: `useMyCorrespondence`, `getAwaitingAcceptance`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the dot**

`nav-main.tsx` already carries `bellCount` on the Home item. Add a separate boolean so a decision waiting is visually distinct from unread notifications:

```tsx
const { data: mine } = useMyCorrespondence(workspace.id);
const hasPendingAssignments = (mine?.pendingAssignments?.length ?? 0) > 0;

// in navItems, on the Home entry:
      hasDot: hasPendingAssignments,
```

Render a small filled circle next to the title when `hasDot` is true, following the styling already used for `bellCount`.

The dot means "something waits for your decision". Do not include open delegated actions: a busy registrar always has some, and the dot would never clear.

- [ ] **Step 2: Add the GM watchlist**

In `correspondence.tsx`, add an "Awaiting acceptance" toggle beside the existing Disposed toggle, listing `getAwaitingAcceptance` results with the letter, the intended recipient, and how long it has waited. Reuse the existing table markup.

- [ ] **Step 3: Verify by hand**

With a pending assignment outstanding, confirm the dot appears on Home for the recipient and disappears once they accept. Confirm a GM officer sees the letter in Awaiting acceptance.

- [ ] **Step 4: Run the suite and commit**

```bash
pnpm test && pnpm build
git add apps/web/src
git commit -m "feat(correspondence): pending dot on Home and a GM awaiting-acceptance list"
```

---

## Done when

- `pnpm test` and `pnpm test:integration` are green.
- Registering a letter with an assignee leaves `currentAssigneeId` null and the status `captured`.
- The assignee sees a toast, hears a chime, and sees a dot on Home.
- Accepting makes them Main User; rejecting returns the letter to the sender.
- A GM officer can see every unaccepted letter and reassign it.
