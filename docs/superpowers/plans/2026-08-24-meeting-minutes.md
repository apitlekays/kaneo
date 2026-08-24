# Meeting Minutes (Organisation-Level) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record organisation-level meetings — AGM, quarterly committee, EGM — with attendees, agenda items, and action items that reach their assignee through the accept/reject dialog the rest of the app already uses.

**Architecture:** Six new `meeting_*` tables. Meeting types reuse `registerConfigResource`, inheriting CRUD, audit and admin-only writes. Action items become a fourth `PendingDecisionProvider`, so the shared dialog needs no change. Two independent server-side gates: the General Management page gate, and a per-meeting confidentiality rule written as a pure, unit-tested function.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query + Tailwind v4 (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-24-meeting-minutes-design.md`

## Global Constraints

- **Three unrelated features are called "minutes".** This plan builds only the organisation-level one. Never touch `task_mom` (Project Minutes) or `letter_minute` / `letter_minute_update` (Letter Minutes), and never rename them. All new tables take the `meeting_` prefix. In UI copy always write the full two-word name — "Meeting Minutes", never bare "Minutes".
- **Acceptance and completion are separate axes.** `acceptance` is whether the work is yours; `status` is whether it is finished. A `pending` action must not be completable — that exact bug shipped in the correspondence module and needed a 409 guard added afterwards.
- **Hiding UI is never the boundary.** Every access rule is enforced server-side. A confidential meeting must not leak its title into a pending-decision card or a notification for someone who may not read it.
- **A decision race claims nothing.** Guard every decision UPDATE with `acceptance = 'pending'` as its predicate and return 409 when it affects no rows — never a silent success.
- **A rejection always carries a written reason.** Empty or whitespace-only is `HTTPException(400)` before any write.
- A member/attendee row has **exactly one** of `userId` or `name`. Enforce it in the create path, not by convention.
- All API inputs validated with Valibot; routes carry `describeRoute` where their neighbours do.
- Biome: double quotes, semicolons, spaces for TS/TSX. Run `npx biome ci .` before committing — it checks every file and catches what a subset check misses. Never pipe it through `tail`; its verdict is on the last line and truncating it has already hidden one failure in this repo.
- Integration tests: use your own container and **`pnpm --filter @kaneo/api test:integration`**, never the root `pnpm test:integration` — turbo drops `DATABASE_URL` and falls back to port 5432.
- Conventional Commits.

---

## File Structure

**API**
- `apps/api/src/database/schema.ts` — six tables
- `apps/api/src/database/index.ts` — barrel exports
- `apps/api/drizzle/00NN_*.sql` — generated
- `apps/api/src/meeting/access.ts` — `canReadMeeting` (new, pure)
- `apps/api/src/meeting/action-rules.ts` — decision + adoption rules (new, pure)
- `apps/api/src/meeting/index.ts` — routes (new)
- `apps/api/src/pending-decision/providers/meeting-action.ts` — provider (new)
- `apps/api/src/pending-decision/registry.ts` — register it

**Web**
- `apps/web/src/fetchers/meeting/index.ts` — types + fetchers (new)
- `apps/web/src/hooks/queries/meeting/` — query/mutation hooks (new)
- `apps/web/src/components/general-management/minutes-manager.tsx` — replace the stub

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/src/database/schema.ts`
- Modify: `apps/api/src/database/index.ts`
- Create: generated migration under `apps/api/drizzle/`

**Interfaces:**
- Produces: `meetingTypeTable`, `meetingBodyTable`, `meetingBodyMemberTable`, `meetingTable`, `meetingAttendeeTable`, `meetingMinuteItemTable`, `meetingActionTable`

- [ ] **Step 1: Add the config table**

Meeting types follow `gmCategoryTable` exactly (around line 1843) — read it first and match its shape:

```ts
export const meetingTypeTable = pgTable(
  "meeting_type",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("meeting_type_workspaceId_idx").on(table.workspaceId),
    unique("meeting_type_ws_key_unique").on(table.workspaceId, table.key),
  ],
);
```

- [ ] **Step 2: Add the body tables**

```ts
export const meetingBodyTable = pgTable(
  "meeting_body",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Free text a human reads ("half plus one"). Encoding every
    // constitution's arithmetic is deliberately out of scope.
    quorumRule: text("quorum_rule"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("meeting_body_workspaceId_idx").on(table.workspaceId)],
);

export const meetingBodyMemberTable = pgTable(
  "meeting_body_member",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    bodyId: text("body_id")
      .notNull()
      .references(() => meetingBodyTable.id, { onDelete: "cascade" }),
    // Exactly one of userId / name is set. An external member has no
    // account; a linked member is the only kind that can hold an action.
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    // chair | secretary | member
    role: text("role").notNull().default("member"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("meeting_body_member_bodyId_idx").on(table.bodyId)],
);
```

- [ ] **Step 3: Add the meeting tables**

```ts
export const meetingTable = pgTable(
  "meeting",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    meetingTypeId: text("meeting_type_id").references(
      () => meetingTypeTable.id,
      { onDelete: "set null" },
    ),
    // Null for a standalone meeting. Quorum is only meaningful with a body.
    bodyId: text("body_id").references(() => meetingBodyTable.id, {
      onDelete: "set null",
    }),
    scheduledAt: timestamp("scheduled_at", { mode: "date" }),
    location: text("location"),
    confidential: boolean("confidential").notNull().default(false),
    // draft | adopted
    status: text("status").notNull().default("draft"),
    adoptedAt: timestamp("adopted_at", { mode: "date" }),
    // The later meeting at which these minutes were adopted. Self-reference,
    // and it MUST be set null on delete: removing a later meeting must not
    // cascade away an earlier meeting's adoption record.
    adoptedByMeetingId: text("adopted_by_meeting_id"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("meeting_workspaceId_idx").on(table.workspaceId),
    index("meeting_bodyId_idx").on(table.bodyId),
  ],
);
```

`adoptedByMeetingId` carries **no** `.references()`, matching how `letterTable.primaryAttachmentId` handles a self/forward reference in this file — a comment there explains it avoids a definition cycle. Follow that precedent rather than reordering the file.

```ts
export const meetingAttendeeTable = pgTable(
  "meeting_attendee",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetingTable.id, { onDelete: "cascade" }),
    // Exactly one of userId / name, as with body members.
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    // present | apology | absent — absentees are recorded, not omitted.
    attendance: text("attendance").notNull().default("present"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("meeting_attendee_meetingId_idx").on(table.meetingId)],
);

export const meetingMinuteItemTable = pgTable(
  "meeting_minute_item",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetingTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    agenda: text("agenda").notNull(),
    discussion: text("discussion"),
    decision: text("decision"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("meeting_minute_item_meetingId_idx").on(table.meetingId)],
);

export const meetingActionTable = pgTable(
  "meeting_action",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetingTable.id, { onDelete: "cascade" }),
    // Null when the action arose outside any single agenda item.
    minuteItemId: text("minute_item_id").references(
      () => meetingMinuteItemTable.id,
      { onDelete: "set null" },
    ),
    assigneeId: text("assignee_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    fromUserId: text("from_user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    dueAt: timestamp("due_at", { mode: "date" }),
    // pending | accepted | rejected — is this work yours?
    acceptance: text("acceptance").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    // open | done | cancelled — is it finished? A separate axis on purpose.
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { mode: "date" }),
    completedBy: text("completed_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("meeting_action_meetingId_idx").on(table.meetingId),
    index("meeting_action_assigneeId_idx").on(table.assigneeId),
  ],
);
```

- [ ] **Step 4: Add all six to the barrel**

`apps/api/src/database/index.ts` exports every table in a `schema` object. Add each in the alphabetical position the file uses. `tests/api/database/schema-barrel.test.ts` fails if one is missing — run it.

- [ ] **Step 5: Generate and apply**

Run `pnpm --filter @kaneo/api db:generate`, keeping drizzle's filename and number. Never hand-write or hand-edit the snapshot JSON or the journal — drizzle chains snapshots by id and a hand-edited one forks the chain for every later migration.

Confirm the generated SQL contains **no backfill** — nothing exists to grandfather.

Then, against your own container:

```bash
docker run -d --name kaneo-mtg-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5481:5432 postgres:16-alpine
```

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5481/kaneo_test pnpm --filter @kaneo/api test:integration
```

Migrations run on startup, so a clean run proves the migration applies and breaks nothing. Report the total. Tear down with `docker rm -f kaneo-mtg-pg` afterwards, even on failure.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database apps/api/drizzle
git commit --no-verify -m "feat(api): meeting minutes schema"
```

---

### Task 2: The access rule, as a pure function

**Files:**
- Create: `apps/api/src/meeting/access.ts`
- Test: `tests/api/meeting/access.test.ts`

**Interfaces:**
- Produces: `canReadMeeting(args: { confidential: boolean; attendeeUserIds: string[]; userId: string; isGlobalAdmin: boolean }): boolean`

Extracted so the rule is testable without a database. The last access-control change in this codebase shipped two Critical bugs because the boundary was reasoned about rather than tested; this one gets a tested rule before any route uses it.

- [ ] **Step 1: Write the failing test**

Create `tests/api/meeting/access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canReadMeeting } from "../../../apps/api/src/meeting/access";

const base = {
  confidential: false,
  attendeeUserIds: ["u1", "u2"],
  userId: "u3",
  isGlobalAdmin: false,
};

describe("canReadMeeting", () => {
  it("lets any page holder read a non-confidential meeting", () => {
    expect(canReadMeeting(base)).toBe(true);
  });

  it("refuses a non-attendee on a confidential meeting", () => {
    expect(canReadMeeting({ ...base, confidential: true })).toBe(false);
  });

  it("lets an attendee read a confidential meeting", () => {
    expect(
      canReadMeeting({ ...base, confidential: true, userId: "u1" }),
    ).toBe(true);
  });

  it("lets a global admin read a confidential meeting they did not attend", () => {
    expect(
      canReadMeeting({ ...base, confidential: true, isGlobalAdmin: true }),
    ).toBe(true);
  });

  it("refuses a non-attendee on a confidential meeting with no attendees at all", () => {
    // A meeting whose attendees have not been recorded yet must not become
    // readable by everyone just because the list is empty.
    expect(
      canReadMeeting({ ...base, confidential: true, attendeeUserIds: [] }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/meeting/access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/meeting/access.ts`:

```ts
/**
 * Who may read a meeting's minutes. A normal meeting is readable by anyone
 * who already holds the General Management page; a confidential one is
 * readable only by the people who were there, plus global admins.
 *
 * Deliberately pure: the routes compose it with the real lookups, and the
 * pending-decision provider applies the same rule so a confidential
 * meeting's title cannot leak through an action card.
 */
export function canReadMeeting(args: {
  confidential: boolean;
  attendeeUserIds: string[];
  userId: string;
  isGlobalAdmin: boolean;
}): boolean {
  if (!args.confidential) return true;
  if (args.isGlobalAdmin) return true;
  return args.attendeeUserIds.includes(args.userId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the tests bite**

Change the body to `return true`. The two refusal tests must FAIL. Restore. Then remove the `isGlobalAdmin` branch; the global-admin test must FAIL. Restore. Report both observations verbatim.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/meeting/access.ts tests/api/meeting/access.test.ts
git commit --no-verify -m "feat(api): meeting read-access rule"
```

---

### Task 3: The action decision and adoption rules

**Files:**
- Create: `apps/api/src/meeting/action-rules.ts`
- Test: `tests/api/meeting/action-rules.test.ts`

**Interfaces:**
- Produces:
  - `assertCanDecideAction(action: { assigneeId: string | null; acceptance: string }, userId: string): void` — 403 unless the caller is the assignee; 409 if already decided
  - `actionAfterDecision(decision: "accepted" | "rejected", assigneeId: string | null): { assigneeId: string | null; acceptance: string }`
  - `canAdoptMeeting(args: { isGlobalAdmin: boolean; bodyRole: string | null }): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/api/meeting/action-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  actionAfterDecision,
  assertCanDecideAction,
  canAdoptMeeting,
} from "../../../apps/api/src/meeting/action-rules";

describe("assertCanDecideAction", () => {
  it("lets the assignee decide a pending action", () => {
    expect(() =>
      assertCanDecideAction({ assigneeId: "u1", acceptance: "pending" }, "u1"),
    ).not.toThrow();
  });

  it("refuses anyone who is not the assignee", () => {
    expect(() =>
      assertCanDecideAction({ assigneeId: "u1", acceptance: "pending" }, "u2"),
    ).toThrow();
  });

  it("refuses an action with no assignee", () => {
    expect(() =>
      assertCanDecideAction({ assigneeId: null, acceptance: "pending" }, "u1"),
    ).toThrow();
  });

  it("refuses a second decision", () => {
    for (const acceptance of ["accepted", "rejected"]) {
      expect(() =>
        assertCanDecideAction({ assigneeId: "u1", acceptance }, "u1"),
      ).toThrow();
    }
  });
});

describe("actionAfterDecision", () => {
  it("keeps the assignee on accept", () => {
    expect(actionAfterDecision("accepted", "u1")).toEqual({
      assigneeId: "u1",
      acceptance: "accepted",
    });
  });

  it("clears the assignee on reject", () => {
    // The action stays in the meeting's record showing it was assigned and
    // declined. Minutes are a historical record; nothing is deleted.
    expect(actionAfterDecision("rejected", "u1")).toEqual({
      assigneeId: null,
      acceptance: "rejected",
    });
  });
});

describe("canAdoptMeeting", () => {
  it("lets a global admin adopt", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: true, bodyRole: null })).toBe(true);
  });

  it("lets the chair adopt", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: false, bodyRole: "chair" })).toBe(
      true,
    );
  });

  it("lets the secretary adopt", () => {
    expect(
      canAdoptMeeting({ isGlobalAdmin: false, bodyRole: "secretary" }),
    ).toBe(true);
  });

  it("refuses an ordinary member", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: false, bodyRole: "member" })).toBe(
      false,
    );
  });

  it("refuses a non-admin on a standalone meeting, which has no body role", () => {
    expect(canAdoptMeeting({ isGlobalAdmin: false, bodyRole: null })).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Create `apps/api/src/meeting/action-rules.ts`:

```ts
import { HTTPException } from "hono/http-exception";

/**
 * Only the person holding the action may decide it, and only once. A second
 * decision is a 409 rather than a silent overwrite.
 */
export function assertCanDecideAction(
  action: { assigneeId: string | null; acceptance: string },
  userId: string,
): void {
  if (!action.assigneeId || action.assigneeId !== userId)
    throw new HTTPException(403, {
      message: "Only the action's assignee can decide it",
    });
  if (action.acceptance !== "pending")
    throw new HTTPException(409, {
      message: "This action was already decided",
    });
}

export function actionAfterDecision(
  decision: "accepted" | "rejected",
  assigneeId: string | null,
): { assigneeId: string | null; acceptance: string } {
  return decision === "accepted"
    ? { assigneeId, acceptance: "accepted" }
    : { assigneeId: null, acceptance: "rejected" };
}

/**
 * Adoption authority. A standalone meeting has no body, so nobody holds a
 * body role on it and only a global admin can adopt.
 */
export function canAdoptMeeting(args: {
  isGlobalAdmin: boolean;
  bodyRole: string | null;
}): boolean {
  if (args.isGlobalAdmin) return true;
  return args.bodyRole === "chair" || args.bodyRole === "secretary";
}
```

Expected: PASS, 11 tests.

- [ ] **Step 3: Prove the tests bite**

Remove the `acceptance !== "pending"` check; the second-decision test must FAIL. Restore. Then make `canAdoptMeeting` return `true` unconditionally; both refusal tests must FAIL. Restore. Report both observations verbatim.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/meeting/action-rules.ts tests/api/meeting/action-rules.test.ts
git commit --no-verify -m "feat(api): meeting action and adoption rules"
```

---

### Task 4: Meeting types as a config resource

**Files:**
- Modify: `apps/api/src/correspondence/index.ts` — one `registerConfigResource` call
- Test: `tests/api-integration/meeting-types.test.ts`

**Interfaces:**
- Consumes: `meetingTypeTable` from Task 1
- Produces: `GET/POST/PUT/DELETE /correspondence/config/meeting-types`

- [ ] **Step 1: Register the resource**

Read the `categories` descriptor at `apps/api/src/correspondence/index.ts:208` first and mirror it exactly — same shape, same `optStr`/`optBool` helpers, same soft-deactivate.

```ts
registerConfigResource(app, {
  path: "meeting-types",
  entityType: "meeting_type",
  createSchema: v.object({
    workspaceId: v.string(),
    key: v.string(),
    label: v.string(),
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    key: optStr,
    label: optStr,
    active: optBool,
  }),
  // list/create/update/deactivate: copy the categories implementations,
  // substituting meetingTypeTable. Do not invent a different shape.
});
```

Registering here rather than in a new module is deliberate: these routes already carry the page gate, admin-only writes, the audit trail and soft-deactivate. A parallel implementation would have to re-earn all four.

- [ ] **Step 2: Write the integration test**

Create `tests/api-integration/meeting-types.test.ts`. Read `tests/api-integration/correspondence-handover.test.ts` for helpers. Cover:

1. A global admin can create, list, update and deactivate a meeting type.
2. A GM page holder who is not an admin can **list** them (reference data the meeting UI needs) but gets **403** on create, update and deactivate.
3. A deactivated type is absent from the default list and present with `includeInactive=true`.
4. Two types with the same `key` in one workspace are rejected by the unique constraint.

Real arrangements and assertions. A comments-only body is a task failure.

- [ ] **Step 3: Run and commit**

Start your container as in Task 1 (port 5481) and run the integration suite. Report the total, tear down.

```bash
git add apps/api/src/correspondence/index.ts tests/api-integration/meeting-types.test.ts
git commit --no-verify -m "feat(api): meeting types as a config resource"
```

---

### Task 5: Meeting CRUD routes

**Files:**
- Create: `apps/api/src/meeting/index.ts`
- Modify: `apps/api/src/index.ts` — mount the router
- Test: `tests/api-integration/meeting-crud.test.ts`

**Interfaces:**
- Consumes: `canReadMeeting` (Task 2), `canAdoptMeeting` (Task 3), tables from Task 1
- Produces: `POST /meeting`, `GET /meeting?workspaceId=`, `GET /meeting/:id`, `PUT /meeting/:id`, attendee and minute-item sub-routes, `POST /meeting/:id/adopt`

- [ ] **Step 1: Build the routes**

Read `apps/api/src/correspondence/letters.ts` for the established shape: `workspaceAccess.fromQuery`/`fromBody`, `requireWorkspacePageAccess("general-management")` as `pageAccess`, Valibot validators, `describeRoute`.

Every read route resolves the meeting, loads its attendee user ids, and composes `canReadMeeting`. **A refusal is 403; a meeting in another workspace is 404** — do not leak existence across workspaces.

Write routes (create, update, attendees, minute items) require `assertGmAdmin` **or** the caller being the meeting's `createdBy`. State which you implemented in your report.

**Adopted meetings are read-only.** Editing items or attendees on a meeting whose `status` is `adopted` must be refused with 409. Actions remain mutable — accepting and completing them is the work adoption sets in motion.

`POST /meeting/:id/adopt` takes `{ workspaceId, adoptedByMeetingId }`, checks `canAdoptMeeting` with the caller's body role (null when the meeting has no body), sets `status`, `adoptedAt` and `adoptedByMeetingId`, and is guarded on `status = 'draft'` so a second adopt claims nothing and returns 409.

- [ ] **Step 2: Enforce the one-of-two rule**

Creating an attendee or body member with **both** `userId` and `name`, or **neither**, is `HTTPException(400)`. Enforce in the create path — the schema cannot express it.

- [ ] **Step 3: Write the integration test**

Create `tests/api-integration/meeting-crud.test.ts`. Cover:

1. A GM page holder creates a meeting, adds attendees and minute items, and reads it back.
2. A **standalone meeting** — no `bodyId` — works end to end. This is the path most likely to be forgotten, since every body-related query must tolerate null.
3. A non-attendee gets **403** on a confidential meeting and **200** on a normal one; a global admin gets **200** on both.
4. A meeting in another workspace is **404**, not 403.
5. An attendee with both `userId` and `name` is 400; with neither is 400.
6. Adoption by a chair succeeds and records `adoptedByMeetingId`; by an ordinary member is refused; a second adopt is 409.
7. Editing a minute item on an adopted meeting is 409.

- [ ] **Step 4: Prove it bites**

Remove the `canReadMeeting` call from the detail route and confirm case 3's confidential assertion FAILS. Restore. Report the observation verbatim.

- [ ] **Step 5: Run and commit**

```bash
git add apps/api/src/meeting apps/api/src/index.ts tests/api-integration/meeting-crud.test.ts
git commit --no-verify -m "feat(api): meeting minutes routes"
```

---

### Task 6: Actions and the pending-decision provider

**Files:**
- Modify: `apps/api/src/meeting/index.ts` — action create/complete routes
- Create: `apps/api/src/pending-decision/providers/meeting-action.ts`
- Modify: `apps/api/src/pending-decision/registry.ts`
- Test: `tests/api/pending-decision/meeting-action-provider.test.ts`, `tests/api-integration/meeting-actions.test.ts`

**Interfaces:**
- Consumes: `assertCanDecideAction`, `actionAfterDecision` (Task 3); `canReadMeeting` (Task 2)
- Produces: `meetingActionProvider` with `source: "meeting-action"`; exported pure `toPendingItem(row)`

- [ ] **Step 1: Write the failing mapper test**

Create `tests/api/pending-decision/meeting-action-provider.test.ts`, testing the pure mapper only:

```ts
import { describe, expect, it } from "vitest";
import { toPendingItem } from "../../../apps/api/src/pending-decision/providers/meeting-action";

const row = {
  id: "a1",
  meetingId: "m1",
  meetingTitle: "Q3 Committee Meeting",
  description: "Draft the audit response",
  dueAt: new Date("2026-09-30T00:00:00.000Z"),
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
};

describe("meeting-action toPendingItem", () => {
  it("names the item by the meeting", () => {
    const item = toPendingItem(row, "ws-1");
    expect(item.source).toBe("meeting-action");
    expect(item.title).toBe("Q3 Committee Meeting");
    expect(item.id).toBe("a1");
  });

  it("carries the action so the reader knows what they are accepting", () => {
    expect(toPendingItem(row, "ws-1").subtitle).toContain(
      "Draft the audit response",
    );
  });

  it("always requires a reason to reject", () => {
    expect(toPendingItem(row, "ws-1").requiresReason).toBe(true);
  });

  it("links to a route that exists", () => {
    // A sibling provider shipped an href to a nonexistent route, so every
    // decision in the dialog 404'd. Assert the real shape.
    expect(toPendingItem(row, "ws-1").href).toBe(
      "/dashboard/category/general-management",
    );
  });
});
```

Before writing the implementation, **verify that href against `apps/web/src/routes/`** and use whatever the real General Management route is. If it differs from the above, fix both the test and the mapper and say so in your report.

- [ ] **Step 2: Build the provider**

Mirror `apps/api/src/pending-decision/providers/correspondence.ts`.

`list` returns `pending` actions assigned to the user, **filtered by `canReadMeeting`** — a confidential meeting's title must not reach someone who cannot read it. Note the deliberate difference from the correspondence provider: there is no sealed state, and an action from a `draft` meeting is real work its assignee should see.

`decide` loads the action scoped to the workspace, calls `assertCanDecideAction`, applies `actionAfterDecision`, guards its UPDATE with `acceptance = 'pending'` and returns 409 when it claims no rows, stores the reason on reject, and notifies `fromUserId` — **skipping the notification when `fromUserId` is null**. Reject with an empty or whitespace-only reason throws `HTTPException(400)` before any write.

Register in `registry.ts` as the fourth provider. Never remove or reorder an entry you did not add.

- [ ] **Step 3: The completion guard**

`POST /meeting/:id/actions/:actionId/complete` must refuse an action whose `acceptance` is not `accepted`, with 409. Accepting is not doing, and an unaccepted action is not yet anyone's work.

- [ ] **Step 4: Write the integration test**

Create `tests/api-integration/meeting-actions.test.ts`. Cover:

1. An action assigned to another user is `pending` and appears in their `GET /pending-decision`.
2. Accepting keeps the assignee and sets `accepted`.
3. Rejecting with a reason clears the assignee, stores the reason, notifies `fromUserId`, and leaves the action in the meeting's record.
4. Rejecting with an empty reason is 400 and changes nothing.
5. A second decision is 409.
6. A `pending` action cannot be completed (409); an accepted one can.
7. **An action on a confidential meeting does not appear in a non-attendee's pending list**, and its meeting title appears nowhere in that response.

Case 7 is the one that matters most — it is the regression test for a leak the UI cannot prevent.

- [ ] **Step 5: Run and commit**

```bash
git add apps/api/src/meeting apps/api/src/pending-decision tests
git commit --no-verify -m "feat(api): meeting actions await acceptance"
```

---

### Task 7: Web data layer

**Files:**
- Create: `apps/web/src/fetchers/meeting/index.ts`
- Create: `apps/web/src/hooks/queries/meeting/use-meetings.ts`, `use-meeting.ts`
- Create: `apps/web/src/hooks/queries/meeting/use-meeting-mutations.ts`
- Test: `apps/web/src/hooks/queries/meeting/invalidations.test.tsx`

**Interfaces:**
- Produces: `Meeting`, `MeetingAttendee`, `MeetingMinuteItem`, `MeetingAction` types; fetchers; `useMeetings(workspaceId)`, `useMeeting(workspaceId, id)`, and mutation hooks

- [ ] **Step 1: Build fetchers and hooks**

Follow `apps/web/src/fetchers/correspondence/letters.ts` and the neighbouring hooks. Prefer `type` over `interface`.

Mutations invalidate `["meetings", workspaceId]` and, for single-meeting writes, `["meeting", workspaceId, meetingId]`.

**Read the real key names from the query hooks you write and use those exact arrays in the mutations** — an invalidation aimed at a key nobody queries is dead code that passes its own test. This has already happened once in this repo.

Every mutation needs an `onError` that surfaces the failure with `toast.error` from `@/lib/toast` — **not `sonner`**, which this repo no longer uses. Match a neighbouring mutation hook.

- [ ] **Step 2: Write the invalidation test**

Follow `apps/web/src/hooks/mutations/notification/invalidations.test.tsx`: a real `QueryClient`, a spy on `invalidateQueries`, mutate, assert the exact keys.

- [ ] **Step 3: Prove it bites**

Remove one invalidation, confirm the test FAILS, restore. Report the observation.

- [ ] **Step 4: Run and commit**

Run `pnpm --filter @kaneo/web test`. Do **not** run `pnpm --filter @kaneo/web build`.

```bash
git add apps/web/src/fetchers/meeting apps/web/src/hooks/queries/meeting
git commit --no-verify -m "feat(web): meeting minutes data layer"
```

---

### Task 8: The Minutes Manager UI

**Files:**
- Modify: `apps/web/src/components/general-management/minutes-manager.tsx` — replace the stub
- Create: `apps/web/src/components/general-management/meeting-detail-dialog.tsx`
- Test: `apps/web/src/components/general-management/minutes-manager.test.tsx`

**Interfaces:**
- Consumes: everything from Task 7

- [ ] **Step 1: Write the failing tests**

Create `minutes-manager.test.tsx`. Mock the query hooks. Cover:

1. A list of meetings renders title, type and date.
2. An empty list renders an empty state, not a spinner forever and not an error.
3. Creating a meeting calls the mutation with the entered values.
4. A meeting marked confidential renders a visible marker, so a reader knows the minutes are restricted before they share them.

A test body left as comments, or one asserting nothing, is a task failure.

- [ ] **Step 2: Build the UI**

`MinutesManager` lists meetings and opens `MeetingDetailDialog` — attendees, minute items, actions, and adoption state.

Follow the markup and spacing in `letter-detail-dialog.tsx` rather than inventing a new visual language. Reuse `AttachmentRow`-style patterns where they fit.

Use the full name **"Meeting Minutes"** in headings and empty states, never bare "Minutes" — three features share that word and users see two of them.

Show adoption state plainly: a `draft` meeting says so; an `adopted` one shows when and by which meeting.

- [ ] **Step 3: Prove the tests bite**

Break the confidential marker's condition, confirm test 4 FAILS, restore. Report the observation.

- [ ] **Step 4: Run and commit**

Run `pnpm --filter @kaneo/web test` and `npx tsc --noEmit -p apps/web`.

```bash
git add apps/web/src/components/general-management
git commit --no-verify -m "feat(web): meeting minutes management UI"
```

---

### Task 9: Full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Start PostgreSQL**

```bash
docker run -d --name kaneo-mtg-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5481:5432 postgres:16-alpine
```

- [ ] **Step 2: Run everything**

```bash
pnpm test
npx biome ci .
pnpm --filter @kaneo/web build
DATABASE_URL=postgresql://postgres:postgres@localhost:5481/kaneo_test pnpm --filter @kaneo/api test:integration
```

Report every total. **Do not pipe `biome ci .` through `tail`** — its verdict is the last line and truncating it has already hidden a failure in this repo.

- [ ] **Step 3: Confirm the other two minutes modules are untouched**

```bash
git diff --stat <merge-base> HEAD -- apps/api/src/correspondence/letters.ts apps/api/src/task-mom apps/web/src/components/project/project-minutes.tsx
```

Expect **no changes**. This plan builds the organisation-level module only; a diff here means Project or Letter Minutes were altered, which is a spec violation — report it rather than fixing it.

- [ ] **Step 4: Confirm confidentiality cannot leak**

```bash
/usr/bin/grep -rn "canReadMeeting" apps/api/src
```

Every read path and the provider's `list` must appear. A meeting read route or the provider missing from this list is a leak — report it.

- [ ] **Step 5: Tear down and report**

`docker rm -f kaneo-mtg-pg`, even on failure. State every total. Report BLOCKED with exact output if anything failed.

---

## Browser verification (before this branch is called done)

1. Open General Management → Minutes Manager. Create a committee meeting, add two attendees (one a workspace user, one an outside name) and two agenda items.
2. Assign an action to the linked attendee. Sign in as them: the accept/reject dialog offers it with the meeting's title, and a chime sounds once.
3. Accept it. It shows as theirs. Confirm it cannot be marked done before acceptance by trying the reverse on a second action.
4. Reject a third action with a reason. It stays in the minutes showing it was assigned and declined, and the person who recorded it is notified.
5. Mark a meeting confidential. As a GM page holder who did not attend, confirm it is absent from the list — not shown-and-locked — and that its actions do not appear in your pending decisions.
6. Adopt a meeting as chair, recording the adopting meeting. Confirm its agenda items can no longer be edited, and that its actions still can.
7. Create a meeting with **no** body. Confirm it works end to end and shows no quorum.
