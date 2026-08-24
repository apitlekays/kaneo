# Global Admin Column and GM Admin-Only Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict General Management's Overview and Settings to global admins, and let a global admin promote or demote another member from the workspace Access Management table.

**Architecture:** Almost everything needed already exists. `global-admin` is in `GLOBAL_ADMIN_ROLES`, and `hasWorkspacePageAccess` returns true for a global admin *before* consulting the grant matrix — so the role already confers every page, current and future. Config writes already call `assertGmAdmin`. This plan therefore moves two *read* routes behind `assertGmAdmin`, adds one `previousRole` column so a demotion can restore what someone was, and adds one endpoint plus one table column to drive it.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query + Tailwind v4 (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-24-global-admin-column-and-gm-admin-pages-design.md`

## Global Constraints

- `global-admin` already grants every page. **Do not** write per-page grant rows when promoting someone — the role is the mechanism, and writing grants would create a second source of truth that drifts.
- The workspace **owner is never modifiable** through the new endpoint: 403.
- Promotion must be **idempotent**. Enabling an already-global-admin member must not overwrite `previousRole` with `"global-admin"` — that would strand them as an admin forever. This is the single most important behaviour in the plan.
- Identify a member by **`userId`**, scoping updates by `(workspaceId, userId)`. The members payload's `id` IS `userTable.id`. Do **not** copy `useUpdateWorkspaceUserRole`, which passes a Better Auth `memberId` — a different identifier.
- Role and `previousRole` change in **one statement**; a partial write must be impossible.
- **No audit event** — `workspace-access` records none today, and a lone one here would be an inconsistent half-measure.
- Letter work is untouched: only `GET /config/*` and `GET /summary` change hands. Every other correspondence route keeps `pageAccess`.
- All API inputs validated with Valibot; routes carry `describeRoute` where the neighbouring routes do.
- Biome: double quotes, semicolons, spaces for TS/TSX. Run `npx biome ci .` before committing — it checks all files and catches what a subset check misses. Conventional Commits.

---

## File Structure

**API**
- `apps/api/src/database/schema.ts` — `previousRole` on `workspaceUserTable`
- `apps/api/drizzle/00NN_*.sql` — generated
- `apps/api/src/workspace-access/global-admin-rules.ts` — the pure rules (new)
- `apps/api/src/workspace-access/index.ts` — the new endpoint
- `apps/api/src/correspondence/index.ts` — config GET gating
- `apps/api/src/correspondence/letters.ts` — summary gating

**Web**
- `apps/web/src/fetchers/workspace-access/index.ts` — fetcher
- `apps/web/src/hooks/queries/workspace-access/use-set-global-admin.ts` — mutation hook (new)
- `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/access.tsx` — the column
- `apps/web/src/components/general-management/gm-shell.tsx` — hide the two sections

---

### Task 1: The `previousRole` column

**Files:**
- Modify: `apps/api/src/database/schema.ts` (`workspaceUserTable`, search for `pgTable(\n  "workspace_member"`)
- Create: generated migration under `apps/api/drizzle/`

**Interfaces:**
- Produces: `workspaceUserTable.previousRole: text | null`

- [ ] **Step 1: Add the column**

In `workspaceUserTable`, immediately after the `role` line:

```ts
    // The role this member held before being promoted to global-admin, so a
    // demotion restores it rather than flattening them to "member". Null
    // means "never promoted through the Global Admin control" — which is
    // every pre-existing row, so this column grandfathers itself.
    previousRole: text("previous_role"),
```

`workspace_member` is Better Auth's organization member table. An extra nullable column is ignored by Better Auth — do not attempt to register it there.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @kaneo/api db:generate`

Keep whatever filename and number drizzle produces. Never hand-write or hand-edit the snapshot JSON or the journal entry — drizzle chains snapshots by id and a hand-edited one forks the chain for every later migration.

- [ ] **Step 3: Confirm it is additive with no backfill**

```bash
/usr/bin/grep -n "previous_role" apps/api/drizzle/*.sql
```

Expect exactly one `ADD COLUMN "previous_role" text;`. An `UPDATE workspace_member SET previous_role` statement is a spec violation — null is the correct value for every existing row. Report it rather than fixing it.

- [ ] **Step 4: Apply it against a real database**

```bash
docker run -d --name kaneo-ga-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5461:5432 postgres:16-alpine
```

Wait for `docker exec kaneo-ga-pg pg_isready -U postgres`, then from `apps/api`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5461/kaneo_test npx vitest run --config vitest.integration.config.ts
```

Migrations run on startup, so a clean run proves the migration applies and breaks nothing. Report the total. Tear down with `docker rm -f kaneo-ga-pg` afterwards, even on failure.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database apps/api/drizzle
git commit --no-verify -m "feat(api): remember a member's role before promotion"
```

---

### Task 2: The promotion rules, as pure functions

**Files:**
- Create: `apps/api/src/workspace-access/global-admin-rules.ts`
- Test: `tests/api/workspace-access/global-admin-rules.test.ts`

**Interfaces:**
- Produces:
  - `GLOBAL_ADMIN_ROLE = "global-admin"`
  - `nextRoleForGlobalAdmin(args: { currentRole: string; previousRole: string | null; enabled: boolean }): { role: string; previousRole: string | null } | null` — returns `null` when the request is a no-op

Extracted so the idempotency rule can be tested without a database. The route composes it with the real lookups.

- [ ] **Step 1: Write the failing test**

Create `tests/api/workspace-access/global-admin-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextRoleForGlobalAdmin } from "../../../apps/api/src/workspace-access/global-admin-rules";

describe("nextRoleForGlobalAdmin", () => {
  it("promotes a member and remembers what they were", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "manager",
        previousRole: null,
        enabled: true,
      }),
    ).toEqual({ role: "global-admin", previousRole: "manager" });
  });

  it("restores the remembered role on demotion", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "global-admin",
        previousRole: "manager",
        enabled: false,
      }),
    ).toEqual({ role: "manager", previousRole: null });
  });

  it("falls back to member when nothing was remembered", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "global-admin",
        previousRole: null,
        enabled: false,
      }),
    ).toEqual({ role: "member", previousRole: null });
  });

  it("is a no-op when promoting someone already promoted", () => {
    // The bug this exists to prevent: without it, previousRole becomes
    // "global-admin" and the member can never be demoted back to anything.
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "global-admin",
        previousRole: "manager",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("is a no-op when demoting someone who is not a global admin", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "member",
        previousRole: null,
        enabled: false,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/workspace-access/global-admin-rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `apps/api/src/workspace-access/global-admin-rules.ts`:

```ts
export const GLOBAL_ADMIN_ROLE = "global-admin";

/**
 * What a member's role and remembered-role become when the Global Admin
 * toggle is flipped, or `null` when the request changes nothing.
 *
 * The no-op case is load-bearing: promoting an already-promoted member
 * would otherwise record "global-admin" as their previous role, and the
 * demotion that followed would hand it straight back.
 */
export function nextRoleForGlobalAdmin(args: {
  currentRole: string;
  previousRole: string | null;
  enabled: boolean;
}): { role: string; previousRole: string | null } | null {
  const isGlobalAdmin = args.currentRole === GLOBAL_ADMIN_ROLE;
  if (args.enabled === isGlobalAdmin) return null;
  return args.enabled
    ? { role: GLOBAL_ADMIN_ROLE, previousRole: args.currentRole }
    : { role: args.previousRole ?? "member", previousRole: null };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/workspace-access/global-admin-rules.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the tests bite**

Delete the `if (args.enabled === isGlobalAdmin) return null;` line. Both no-op tests must FAIL. Restore. Then change `args.previousRole ?? "member"` to `args.previousRole as string`. The "falls back to member" test must FAIL. Restore. Report both observations verbatim.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workspace-access/global-admin-rules.ts tests/api/workspace-access/global-admin-rules.test.ts
git commit --no-verify -m "feat(api): global admin promotion rules"
```

---

### Task 3: The promote/demote endpoint

**Files:**
- Modify: `apps/api/src/workspace-access/index.ts` — add a route after the existing `.put("/:workspaceId", ...)` matrix toggle
- Test: `tests/api-integration/global-admin-toggle.test.ts`

**Interfaces:**
- Consumes: `nextRoleForGlobalAdmin`, `GLOBAL_ADMIN_ROLE` from Task 2; `workspaceUserTable.previousRole` from Task 1
- Produces: `PUT /workspace-access/:workspaceId/global-admin` taking `{ userId, enabled }`, returning `{ success: true }`

- [ ] **Step 1: Add the route**

Read the existing `.put("/:workspaceId", ...)` matrix toggle first (around line 98) and mirror its shape — the same `workspaceAccess.fromParam`, the same `isGlobalAdmin` actor check, the same member lookup and 404.

Append to the chain, before the final `;`:

```ts
  // Promote or demote a member to/from global-admin. Owner/global-admins
  // only. The role itself is the grant — global admins bypass the page
  // matrix entirely, which is what makes "all future pages" free.
  .put(
    "/:workspaceId/global-admin",
    validator("param", v.object({ workspaceId: v.string() })),
    validator(
      "json",
      v.object({ userId: v.string(), enabled: v.boolean() }),
    ),
    workspaceAccess.fromParam("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const actorId = c.get("userId");
      if (!workspaceId) {
        throw new HTTPException(400, { message: "workspaceId required" });
      }
      if (!(await isGlobalAdmin(actorId, workspaceId))) {
        throw new HTTPException(403, {
          message: "Only workspace admins can edit access",
        });
      }

      const { userId: targetUserId, enabled } = c.req.valid("json");

      const [member] = await db
        .select({
          id: workspaceUserTable.id,
          role: workspaceUserTable.role,
          previousRole: workspaceUserTable.previousRole,
        })
        .from(workspaceUserTable)
        .where(
          and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            eq(workspaceUserTable.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new HTTPException(404, {
          message: "User is not a member of this workspace",
        });
      }
      if (member.role === "owner") {
        throw new HTTPException(403, {
          message: "The workspace owner's role cannot be changed",
        });
      }

      const next = nextRoleForGlobalAdmin({
        currentRole: member.role,
        previousRole: member.previousRole,
        enabled,
      });
      if (next) {
        await db
          .update(workspaceUserTable)
          .set({ role: next.role, previousRole: next.previousRole })
          .where(eq(workspaceUserTable.id, member.id));
      }

      return c.json({ success: true });
    },
  );
```

Import `nextRoleForGlobalAdmin` from `./global-admin-rules`.

Note the update is scoped by `workspaceUserTable.id` — the row already located by `(workspaceId, userId)` — so it cannot touch another workspace's membership for the same user.

- [ ] **Step 2: Write the integration test**

Create `tests/api-integration/global-admin-toggle.test.ts`. Read `tests/api-integration/correspondence-handover.test.ts` first and reuse its helpers (`createWorkspaceMember`, `mockAuthenticatedSession`, `resetTestDatabase`). Cover:

1. A global-admin actor promoting a `manager`: the member's `role` becomes `global-admin` and `previous_role` becomes `manager`.
2. Demoting that member restores `role = manager` and clears `previous_role`.
3. Promoting a member with no `previousRole`, then demoting, yields `member`.
4. **Promoting twice leaves `previous_role` at the original role, not `global-admin`** — then demoting still restores the original. This is the regression test for the plan's most important constraint.
5. Targeting the workspace owner returns 403 and changes nothing.
6. A non-admin actor returns 403 and changes nothing.
7. Targeting a user who is not a member returns 404.
8. After promotion, `GET /workspace-access/:workspaceId/me` for that member returns every slug in `ACCESS_PAGE_SLUGS` with `isAdmin: true`, **including a slug they hold no explicit grant for** — proving the role, not the matrix, is doing the work.

Write real arrangements and assertions. A test body left as comments, or one asserting nothing, is a task failure.

- [ ] **Step 3: Run the suites**

Start PostgreSQL as in Task 1 Step 4 (container `kaneo-ga-pg`, port 5461). Run `pnpm --filter @kaneo/api test` and the integration suite with `DATABASE_URL=postgresql://postgres:postgres@localhost:5461/kaneo_test`. Report both totals. Tear the container down afterwards, even on failure.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workspace-access/index.ts tests/api-integration/global-admin-toggle.test.ts
git commit --no-verify -m "feat(api): promote and demote global admins"
```

---

### Task 4: Gate the two GM read paths

**Files:**
- Modify: `apps/api/src/correspondence/index.ts` — the `GET` inside `registerConfigResource` (around line 100)
- Modify: `apps/api/src/correspondence/letters.ts` — the `/summary` route (around line 633)
- Test: extend `tests/api-integration/global-admin-toggle.test.ts`

**Interfaces:**
- Consumes: `assertGmAdmin` from `apps/api/src/correspondence/roles.ts`

**What is actually changing, so you do not over-reach:** config `POST`/`PUT`/`DELETE` **already** call `assertGmAdmin` inside their handlers — only the `GET` does not. Do not add, remove, or restructure the existing write guards. Two reads change hands; nothing else.

- [ ] **Step 1: Gate the config list route**

In `registerConfigResource`, the `.get(base, ...)` handler currently reads the workspace and returns `def.list(...)`. Add the admin assertion before the list call, matching how the sibling `.post` handler does it:

```ts
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
```

Because every config resource is registered through this one function, this single change covers all of them. Leave the `pageAccess` middleware in place — it is the outer workspace gate, and removing it would widen the route.

- [ ] **Step 2: Gate the summary route**

In `apps/api/src/correspondence/letters.ts`, the `/summary` route carries `workspaceAccess.fromQuery("workspaceId")` and `pageAccess`. Add the same two lines inside its handler. Import `assertGmAdmin` from `./roles` if that file does not already import it — check first.

- [ ] **Step 3: Extend the integration test**

Add to `tests/api-integration/global-admin-toggle.test.ts`:

9. A workspace member holding the `general-management` page grant but **not** global admin gets **403** from a `GET /correspondence/config/...` route and **403** from `GET /correspondence/summary`.
10. That same member still gets **200** from a letters route — the register list. This is the test that proves letter work was not caught in the blast radius.
11. After being promoted through the Task 3 endpoint, that same member gets **200** from both previously-403 routes.

Case 10 matters most: it is the regression test for the boundary this task moves.

- [ ] **Step 4: Prove it bites**

Remove the `assertGmAdmin` line you added to the config `GET`. Case 9 must FAIL on the config assertion. Restore. Report the observation verbatim.

- [ ] **Step 5: Run and commit**

Run the API and integration suites, report totals, tear down the container.

```bash
git add apps/api/src/correspondence tests/api-integration/global-admin-toggle.test.ts
git commit --no-verify -m "feat(api): GM config and summary are admin-only"
```

---

### Task 5: Web data layer for the toggle

**Files:**
- Modify: `apps/web/src/fetchers/workspace-access/index.ts`
- Create: `apps/web/src/hooks/queries/workspace-access/use-set-global-admin.ts`
- Test: `apps/web/src/hooks/queries/workspace-access/global-admin-invalidation.test.tsx`

**Interfaces:**
- Produces:
  - `setGlobalAdmin(workspaceId: string, userId: string, enabled: boolean): Promise<{ success: boolean }>`
  - `useSetGlobalAdmin(workspaceId: string)` — invalidates `["workspace-members", workspaceId]` and `["page-access", "me", workspaceId]`

- [ ] **Step 1: Add the fetcher**

In `apps/web/src/fetchers/workspace-access/index.ts`, beside `setPageAccess`, matching its shape exactly:

```ts
/** Promote or demote a member to/from global-admin (owner/global-admin only). */
export async function setGlobalAdmin(
  workspaceId: string,
  userId: string,
  enabled: boolean,
): Promise<{ success: boolean }> {
  const response = await fetch(
    getApiUrl(`workspace-access/${workspaceId}/global-admin`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, enabled }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
```

- [ ] **Step 2: Write the failing invalidation test**

Create `apps/web/src/hooks/queries/workspace-access/global-admin-invalidation.test.tsx`, following `apps/web/src/hooks/mutations/notification/invalidations.test.tsx` for the pattern: render the hook with a real `QueryClient`, spy on `invalidateQueries`, mutate, assert the keys.

Assert **both** keys are invalidated: `["workspace-members", "ws-1"]` and `["page-access", "me", "ws-1"]`. Read `use-workspace-members-list.ts` and `use-my-page-access.ts` first and use whatever key those files actually declare — if they differ from these, the hook and the test both follow the real keys, and you say so in your report.

Without the members invalidation the checkbox snaps back to its old state; without the page-access one, a self-promotion leaves the sidebar stale.

- [ ] **Step 3: Run to verify it fails, then add the hook**

Create `use-set-global-admin.ts` beside `use-set-page-access.ts`, matching its `useMutation` + `onSuccess` invalidation shape.

- [ ] **Step 4: Prove it bites**

Remove one invalidation, confirm the test FAILS, restore. Report the observation.

- [ ] **Step 5: Run and commit**

Run `pnpm --filter @kaneo/web test` and report the total.

```bash
git add apps/web/src/fetchers/workspace-access apps/web/src/hooks/queries/workspace-access
git commit --no-verify -m "feat(web): global admin toggle data layer"
```

---

### Task 6: The Global Admin column

**Files:**
- Modify: `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/access.tsx`
- Test: `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/access.test.tsx`

**Interfaces:**
- Consumes: `useSetGlobalAdmin` from Task 5

- [ ] **Step 1: Write the failing tests**

Create `access.test.tsx`. Mock `useSetGlobalAdmin`, `usePageAccessMatrix`, `useWorkspaceMembersList` and `useWorkspacePermission`. Write real arrangements and assertions for:

1. An `owner` row renders the Global Admin checkbox checked and disabled.
2. An `admin` row renders it checked and disabled.
3. A `member` row renders it unchecked and enabled; ticking it calls the mutation with that member's id and `enabled: true`.
4. A `global-admin` row renders it checked and enabled; unticking calls the mutation with `enabled: false`.
5. On a `global-admin` row, the per-page checkboxes are disabled — the role grants everything, so offering per-page control would misrepresent what is in effect.

A test body left as comments, or one asserting nothing, is a task failure.

- [ ] **Step 2: Run to verify they fail, then build the column**

The file already has `const ADMIN_ROLES = new Set(["owner", "admin", "global-admin"]);` and `const isAdminRow = ADMIN_ROLES.has(member.role);`, and already renders admin rows' page checkboxes as checked-and-disabled. Follow that existing pattern rather than inventing a parallel one.

Add a header cell for the new column between the member column and the first category, and a matching body cell rendering a `Checkbox`:

- `checked` when `ADMIN_ROLES.has(member.role)`
- `disabled` when `member.role === "owner" || member.role === "admin"`, or while the mutation is pending
- `onCheckedChange` calls the Task 5 mutation with `{ userId: member.id, enabled: value === true }`

`member.id` is the **user** id — `/workspace/:id/members` selects `id: userTable.id`, and the existing `setAccess.mutate` call already passes `member.id` as `userId`. Do not reach for a Better Auth member id.

Widen the existing per-page `disabled` condition so it also covers a `global-admin` row.

Add the column header string to `i18n/en-US.json` beside the other `settings:workspaceAccess.*` keys and use it through `t(...)` — do not hardcode English in the component. This branch's precedent is en-US only.

- [ ] **Step 3: Prove the tests bite**

Remove `"owner"` from the disabled condition and confirm test 1 FAILS. Restore. Report the observation verbatim.

- [ ] **Step 4: Run and commit**

Run `pnpm --filter @kaneo/web test` and `npx tsc --noEmit -p apps/web`. Report both. Do **not** run `pnpm --filter @kaneo/web build`.

```bash
git add apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace i18n
git commit --no-verify -m "feat(web): global admin column in access management"
```

---

### Task 7: Hide GM Overview and Settings from non-admins

**Files:**
- Modify: `apps/web/src/components/general-management/gm-shell.tsx`
- Test: `apps/web/src/components/general-management/gm-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `gm-shell.test.tsx`. Mock `useWorkspacePermission` and `useCorrespondenceSummary`. Assert:

1. With `isAdmin: true`, all three section labels render — Overview, Correspondence, Settings.
2. With `isAdmin: false`, only Correspondence renders; Overview and Settings are absent.
3. With `isAdmin: false` and the section state initialised to `"settings"`, the Correspondence panel renders — a stale link must not leave the user staring at an empty shell.

- [ ] **Step 2: Run to verify they fail, then implement**

`gm-shell.tsx` declares:

```ts
const SECTIONS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "correspondence", label: "Correspondence", icon: Mail },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;
```

Derive the visible sections from `useWorkspacePermission().isAdmin` — which resolves `owner | admin | global-admin`, the same set the server treats as global admin — and render the picker from that filtered list. When the current section is not in the visible list, fall back to `"correspondence"`.

This is a display-side convenience. The Task 4 server checks are the real gate; a wrong flag here shows or hides a tab but cannot grant access to config or summary data.

- [ ] **Step 3: Prove the tests bite**

Make the filter return every section unconditionally and confirm test 2 FAILS. Restore. Report the observation.

- [ ] **Step 4: Run and commit**

Run `pnpm --filter @kaneo/web test` and `npx tsc --noEmit -p apps/web`. Report both.

```bash
git add apps/web/src/components/general-management/gm-shell.tsx apps/web/src/components/general-management/gm-shell.test.tsx
git commit --no-verify -m "feat(web): GM overview and settings are admin-only"
```

---

### Task 8: Full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Start PostgreSQL**

```bash
docker run -d --name kaneo-ga-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5461:5432 postgres:16-alpine
```

- [ ] **Step 2: Run everything**

```bash
pnpm test
npx biome ci .
pnpm --filter @kaneo/web build
cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5461/kaneo_test npx vitest run --config vitest.integration.config.ts
```

Report every total. If any suite fails, capture the failing test names and assertion output verbatim before tearing down.

- [ ] **Step 3: Confirm no grant rows are written on promotion**

```bash
/usr/bin/grep -rn "workspacePageAccessTable" apps/api/src/workspace-access/index.ts
```

Every hit must belong to the existing matrix routes. If the new global-admin endpoint touches that table, it has created a second source of truth that will drift from the role — report it rather than fixing it.

- [ ] **Step 4: Confirm the blast radius**

```bash
/usr/bin/grep -c "assertGmAdmin" apps/api/src/correspondence/index.ts apps/api/src/correspondence/letters.ts
```

Report the counts. Then confirm by reading that no route outside config-`GET` and `/summary` gained a new guard, and that no existing `pageAccess` middleware was removed.

- [ ] **Step 5: Tear down**

```bash
docker rm -f kaneo-ga-pg
```

Do this even if a step failed.

- [ ] **Step 6: Report**

State every total plainly. If anything failed, report BLOCKED with exact output rather than a summary.

---

## Browser verification (before this branch is called done)

1. As the workspace owner, open Settings → Workspace → Access Management. The Global Admin column appears; your own row and any `admin` row are checked and greyed out.
2. Tick Global Admin for an ordinary member. Their per-page checkboxes grey out.
3. Sign in as that member. Every sidebar category is visible, including ones they were never granted, and General Management shows Overview, Correspondence and Settings.
4. Untick it. They return to exactly the role they held before — not "member" — and their old page grants are back in effect.
5. As a member with General Management access but not global admin, open General Management. Only Correspondence appears; letter work behaves exactly as before.
