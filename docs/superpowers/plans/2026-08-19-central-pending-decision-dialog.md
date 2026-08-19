# Central Pending-Decision Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared dialog that presents work awaiting a user's decision and takes accept or reject on each item, with correspondence as the first and only provider.

**Architecture:** A provider registry on the API — each module implements one interface, a single endpoint fans out across the registry with `Promise.allSettled` and returns one normalized list. Truth stays in each module's own tables; no mirror table. On the web, one dialog mounted beside `<AppAlerts />` opens when the user is idle, when they land on Home, or when they click the sidebar dot.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query + Base UI dialog + Tailwind v4 (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-19-central-pending-decision-dialog-design.md`

## Global Constraints

- Rejecting correspondence **requires** a reason; accepting takes none. `requiresReason` is `true` on correspondence items.
- The dialog **never** plays a chime. `AppAlerts` owns the audio; a second sound would mean two chimes for one event.
- **409 means gone, not broken.** A 409 from a decide call removes the card with a quiet inline line and refetches. No error toast. Every other failure status gets the normal error toast with the card left in place.
- A provider that throws must not blank the dialog. `Promise.allSettled`, healthy items returned, failed source names reported.
- Existing routes `/letters/:id/assignments/:aid/accept` and `/reject` keep their paths, bodies, and behaviour exactly.
- `tests/api-integration/correspondence-handover.test.ts` must pass **untouched**. Editing that file to make a refactor pass is a task failure.
- All API inputs validated with Valibot; all routes carry `describeRoute`.
- Biome: double quotes, semicolons, spaces for TS/TSX.
- Conventional Commits.

---

## File Structure

**API — new module `apps/api/src/pending-decision/`**
- `types.ts` — `PendingDecisionItem`, `PendingDecisionProvider`, `PendingDecisionDecision`
- `collect.ts` — pure fan-out: `collectPendingDecisions(providers, userId, workspaceId)`
- `registry.ts` — the provider array
- `providers/correspondence.ts` — the letters provider, plus pure `encodeLetterDecisionId` / `decodeLetterDecisionId`
- `index.ts` — the two routes

**API — modified**
- `apps/api/src/correspondence/letters.ts` — extract `decideLetterAssignment`, routes delegate
- `apps/api/src/index.ts` — mount `/pending-decision`

**Web — new**
- `apps/web/src/fetchers/pending-decision/index.ts` — fetchers + `PendingDecisionError`
- `apps/web/src/hooks/queries/pending-decision/use-pending-decisions.ts`
- `apps/web/src/hooks/mutations/pending-decision/use-decide-pending.ts`
- `apps/web/src/hooks/use-pending-dialog-open.ts` — the open/idle rules, pure + hook
- `apps/web/src/components/pending-decision-dialog.tsx`

**Web — modified**
- `apps/web/src/routes/_layout/_authenticated.tsx` — mount the dialog
- `apps/web/src/hooks/use-user-websocket.ts:61` — add `["pending-decisions"]`
- `apps/web/src/components/nav-main.tsx` — dot opens the dialog
- `apps/web/src/i18n/en-US.json` — copy keys

---

### Task 1: Extract `decideLetterAssignment` from the Hono context

**Files:**
- Modify: `apps/api/src/correspondence/letters.ts:210-341` (the `decideAssignment` function) and `:1557-1575` (the two routes)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `decideLetterAssignment(args: { workspaceId: string; userId: string; letterId: string; assignmentId: string; decision: AssignmentDecision; reason: string | null; ip: string | null }): Promise<Letter>` — exported from `apps/api/src/correspondence/letters.ts`. `AssignmentDecision` is `"accepted" | "rejected"`, imported from `./assignment-rules`.

This is a pure refactor. Behaviour must not change: same guards, same 409 messages, same audit event, same websocket broadcasts.

- [ ] **Step 1: Read the current function end to end**

Read `apps/api/src/correspondence/letters.ts` lines 210 through 341. Note the four things it takes off the Hono context, because those become parameters:

| Currently | Becomes |
|---|---|
| `c.get("workspaceId")` | `args.workspaceId` |
| `c.get("userId")` | `args.userId` |
| `c.req.param()` → `id`, `aid` | `args.letterId`, `args.assignmentId` |
| `getIp(c)` (returns `string \| null`) | `args.ip` |

The `note` parameter is renamed `reason` to match the generic interface. It is still written to the audit event's `after.reason` field and nowhere else — the sender's routing instruction in `letterAssignmentTable.note` stays untouched.

- [ ] **Step 2: Rename the function and change its signature**

Replace the current declaration:

```ts
async function decideAssignment(
  c: Context,
  decision: AssignmentDecision,
  note: string | null,
) {
  const ws = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const { id, aid } = c.req.param();
```

with:

```ts
export async function decideLetterAssignment(args: {
  workspaceId: string;
  userId: string;
  letterId: string;
  assignmentId: string;
  decision: AssignmentDecision;
  reason: string | null;
  ip: string | null;
}) {
  const { workspaceId: ws, userId, letterId: id, assignmentId: aid } = args;
  const { decision, reason: note } = args;
```

Destructuring to the old local names (`ws`, `id`, `aid`, `note`) keeps the 130-line body below untouched, which is what makes this reviewable as a refactor.

- [ ] **Step 3: Replace the two context reads inside the body**

Change `ip: getIp(c),` (line ~333) to `ip: args.ip,`.

Change the final `return c.json(updated);` to `return updated;`.

- [ ] **Step 4: Add a thin context adapter so the routes stay unchanged**

Directly above `registerLetterRoutes`, add:

```ts
async function decideAssignment(
  c: Context,
  decision: AssignmentDecision,
  note: string | null,
) {
  const { id, aid } = c.req.param();
  const updated = await decideLetterAssignment({
    workspaceId: c.get("workspaceId") as string,
    userId: c.get("userId") as string,
    letterId: id,
    assignmentId: aid,
    decision,
    reason: note,
    ip: getIp(c),
  });
  return c.json(updated);
}
```

The two route handlers at `letters.ts:1563` and `:1571` are not edited at all — they still call `decideAssignment(c, "accepted", null)` and `decideAssignment(c, "rejected", ...)`.

- [ ] **Step 5: Verify the unit suite and typecheck**

Run: `pnpm --filter @kaneo/api test`
Expected: PASS, same count as before your change (215 at the time of writing).

Run: `pnpm --filter @kaneo/api exec tsc --noEmit`
Expected: no new errors. Record the count before and after — the repo has a pre-existing error baseline and your job is not to change it.

The real proof of this refactor is the integration suite, which needs a live PostgreSQL. That runs in Task 7. Do not edit `tests/api-integration/correspondence-handover.test.ts` for any reason.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/correspondence/letters.ts
git commit -m "refactor(api): lift letter assignment decisions off the Hono context"
```

---

### Task 2: The provider interface and the fan-out

**Files:**
- Create: `apps/api/src/pending-decision/types.ts`
- Create: `apps/api/src/pending-decision/collect.ts`
- Test: `tests/api/pending-decision/collect.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type PendingDecisionDecision = "accepted" | "rejected"`
  - `type PendingDecisionItem = { source: string; id: string; title: string; subtitle: string; context: string[]; href: string; createdAt: Date; requiresReason: boolean }`
  - `type PendingDecisionProvider = { source: string; list(userId: string, workspaceId: string): Promise<PendingDecisionItem[]>; decide(args: { userId: string; workspaceId: string; id: string; decision: PendingDecisionDecision; reason: string | null; ip: string | null }): Promise<void> }`
  - `collectPendingDecisions(providers: PendingDecisionProvider[], userId: string, workspaceId: string): Promise<{ items: PendingDecisionItem[]; failedSources: string[] }>`

- [ ] **Step 1: Write the failing test**

Create `tests/api/pending-decision/collect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { collectPendingDecisions } from "../../../apps/api/src/pending-decision/collect";
import type {
  PendingDecisionItem,
  PendingDecisionProvider,
} from "../../../apps/api/src/pending-decision/types";

function item(
  source: string,
  id: string,
  createdAt: Date,
): PendingDecisionItem {
  return {
    source,
    id,
    title: id,
    subtitle: "",
    context: [],
    href: `/x/${id}`,
    createdAt,
    requiresReason: true,
  };
}

function provider(
  source: string,
  items: PendingDecisionItem[],
): PendingDecisionProvider {
  return {
    source,
    list: async () => items,
    decide: async () => {},
  };
}

describe("collectPendingDecisions", () => {
  it("merges every provider's items oldest first", async () => {
    const a = provider("alpha", [item("alpha", "a1", new Date("2026-03-02"))]);
    const b = provider("beta", [
      item("beta", "b1", new Date("2026-01-05")),
      item("beta", "b2", new Date("2026-05-01")),
    ]);

    const result = await collectPendingDecisions([a, b], "u1", "ws1");

    expect(result.items.map((i) => i.id)).toEqual(["b1", "a1", "b2"]);
    expect(result.failedSources).toEqual([]);
  });

  it("returns the healthy providers' items when one throws", async () => {
    const healthy = provider("alpha", [
      item("alpha", "a1", new Date("2026-03-02")),
    ]);
    const broken: PendingDecisionProvider = {
      source: "beta",
      list: async () => {
        throw new Error("database is on fire");
      },
      decide: async () => {},
    };

    const result = await collectPendingDecisions(
      [healthy, broken],
      "u1",
      "ws1",
    );

    expect(result.items.map((i) => i.id)).toEqual(["a1"]);
    expect(result.failedSources).toEqual(["beta"]);
  });

  it("passes the caller's user and workspace through to each provider", async () => {
    const seen: string[] = [];
    const spy: PendingDecisionProvider = {
      source: "alpha",
      list: async (userId, workspaceId) => {
        seen.push(`${userId}/${workspaceId}`);
        return [];
      },
      decide: async () => {},
    };

    await collectPendingDecisions([spy], "user-9", "ws-4");

    expect(seen).toEqual(["user-9/ws-4"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/pending-decision/collect.test.ts`
Expected: FAIL — cannot resolve `../../../apps/api/src/pending-decision/collect`.

- [ ] **Step 3: Write the types**

Create `apps/api/src/pending-decision/types.ts`:

```ts
export type PendingDecisionDecision = "accepted" | "rejected";

/** One piece of work awaiting a user's accept-or-reject. */
export type PendingDecisionItem = {
  source: string;
  /** Opaque to the client; only the owning provider decodes it. */
  id: string;
  title: string;
  subtitle: string;
  context: string[];
  href: string;
  createdAt: Date;
  requiresReason: boolean;
};

export type PendingDecisionProvider = {
  source: string;
  list(userId: string, workspaceId: string): Promise<PendingDecisionItem[]>;
  decide(args: {
    userId: string;
    workspaceId: string;
    id: string;
    decision: PendingDecisionDecision;
    reason: string | null;
    ip: string | null;
  }): Promise<void>;
};
```

- [ ] **Step 4: Write the fan-out**

Create `apps/api/src/pending-decision/collect.ts`:

```ts
import type { PendingDecisionItem, PendingDecisionProvider } from "./types";

/**
 * Fans out across every registered provider. One provider failing must not
 * blank the queue: a queue that quietly under-reports is worse than one that
 * admits it is incomplete, so the failed sources travel with the items.
 */
export async function collectPendingDecisions(
  providers: PendingDecisionProvider[],
  userId: string,
  workspaceId: string,
): Promise<{ items: PendingDecisionItem[]; failedSources: string[] }> {
  const settled = await Promise.allSettled(
    providers.map((p) => p.list(userId, workspaceId)),
  );

  const items: PendingDecisionItem[] = [];
  const failedSources: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
      return;
    }
    const source = providers[index].source;
    failedSources.push(source);
    console.error(`pending-decision: provider "${source}" failed`, result.reason);
  });

  items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { items, failedSources };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/pending-decision/collect.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Prove the tests bite**

Temporarily delete the `items.sort(...)` line and re-run. The "oldest first" test must fail. Then temporarily change `Promise.allSettled` to `Promise.all` and re-run — the partial-failure test must fail. Restore both. If either test still passes, it is not testing what it claims and must be rewritten before you continue.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pending-decision/types.ts apps/api/src/pending-decision/collect.ts tests/api/pending-decision/collect.test.ts
git commit -m "feat(api): fan out pending decisions across a provider registry"
```

---

### Task 3: The correspondence provider

**Files:**
- Create: `apps/api/src/pending-decision/providers/correspondence.ts`
- Create: `apps/api/src/pending-decision/registry.ts`
- Test: `tests/api/pending-decision/correspondence-provider.test.ts`

**Interfaces:**
- Consumes: `PendingDecisionProvider`, `PendingDecisionItem` from `../types`; `decideLetterAssignment` from `../../correspondence/letters`
- Produces:
  - `encodeLetterDecisionId(letterId: string, assignmentId: string): string`
  - `decodeLetterDecisionId(id: string): { letterId: string; assignmentId: string }` — throws `HTTPException(400)` on a malformed id
  - `correspondenceProvider: PendingDecisionProvider`
  - `providers: PendingDecisionProvider[]` from `registry.ts`

- [ ] **Step 1: Write the failing test for the id codec**

Create `tests/api/pending-decision/correspondence-provider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decodeLetterDecisionId,
  encodeLetterDecisionId,
} from "../../../apps/api/src/pending-decision/providers/correspondence";

describe("letter decision id codec", () => {
  it("round-trips a letter and assignment id", () => {
    const encoded = encodeLetterDecisionId("ltr_abc", "asg_def");
    expect(decodeLetterDecisionId(encoded)).toEqual({
      letterId: "ltr_abc",
      assignmentId: "asg_def",
    });
  });

  it("rejects an id with no separator", () => {
    expect(() => decodeLetterDecisionId("ltr_abc")).toThrow();
  });

  it("rejects an id with an empty half", () => {
    expect(() => decodeLetterDecisionId("ltr_abc:")).toThrow();
    expect(() => decodeLetterDecisionId(":asg_def")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/pending-decision/correspondence-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the provider**

Create `apps/api/src/pending-decision/providers/correspondence.ts`:

```ts
import { and, desc, eq, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { decideLetterAssignment } from "../../correspondence/letters";
import { SEALED_LETTER_STATUSES } from "../../correspondence/letter-list-filter";
import db from "../../database";
import { letterAssignmentTable, letterTable } from "../../database/schema";
import type { PendingDecisionItem, PendingDecisionProvider } from "../types";

/** A letter decision needs both ids, so the opaque item id carries both. */
export function encodeLetterDecisionId(
  letterId: string,
  assignmentId: string,
): string {
  return `${letterId}:${assignmentId}`;
}

export function decodeLetterDecisionId(id: string): {
  letterId: string;
  assignmentId: string;
} {
  const [letterId, assignmentId, ...rest] = id.split(":");
  if (!letterId || !assignmentId || rest.length > 0)
    throw new HTTPException(400, { message: "Malformed decision id" });
  return { letterId, assignmentId };
}

export const correspondenceProvider: PendingDecisionProvider = {
  source: "correspondence",

  async list(userId, workspaceId): Promise<PendingDecisionItem[]> {
    const rows = await db
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
          eq(letterTable.workspaceId, workspaceId),
          eq(letterAssignmentTable.toUserId, userId),
          eq(letterAssignmentTable.status, "pending"),
          // A sealed record cannot be accepted or rejected, so offering the
          // decision would present an item the user can never clear.
          notInArray(letterTable.status, [...SEALED_LETTER_STATUSES]),
        ),
      )
      .orderBy(desc(letterAssignmentTable.createdAt));

    return rows.map((row) => ({
      source: "correspondence",
      id: encodeLetterDecisionId(row.letterId, row.id),
      title: row.refNo ?? "Unregistered",
      subtitle: row.subject,
      context: [
        `Action: ${row.action}`,
        ...(row.note ? [`Instruction: ${row.note}`] : []),
      ],
      href: `/dashboard/correspondence/${row.letterId}`,
      createdAt: row.createdAt,
      requiresReason: true,
    }));
  },

  async decide({ userId, workspaceId, id, decision, reason, ip }) {
    const { letterId, assignmentId } = decodeLetterDecisionId(id);
    await decideLetterAssignment({
      workspaceId,
      userId,
      letterId,
      assignmentId,
      decision,
      reason,
      ip,
    });
  },
};
```

- [ ] **Step 4: Write the registry**

Create `apps/api/src/pending-decision/registry.ts`:

```ts
import { correspondenceProvider } from "./providers/correspondence";
import type { PendingDecisionProvider } from "./types";

/** Add a module here when it has work that awaits a user's decision. */
export const providers: PendingDecisionProvider[] = [correspondenceProvider];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/pending-decision/correspondence-provider.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Prove the test bites**

Temporarily change `decodeLetterDecisionId` to `return { letterId: id, assignmentId: id }` with no validation. The two rejection tests must fail. Restore.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pending-decision/providers/correspondence.ts apps/api/src/pending-decision/registry.ts tests/api/pending-decision/correspondence-provider.test.ts
git commit -m "feat(api): register correspondence as a pending-decision provider"
```

---

### Task 4: The routes

**Files:**
- Create: `apps/api/src/pending-decision/index.ts`
- Modify: `apps/api/src/index.ts` (near the other `api.route(...)` calls around line 556-596)
- Test: `tests/api/pending-decision/resolve-provider.test.ts`

**Interfaces:**
- Consumes: `providers` from `./registry`, `collectPendingDecisions` from `./collect`
- Produces: `resolveProvider(providers: PendingDecisionProvider[], source: string): PendingDecisionProvider` — throws `HTTPException(404)` on an unknown source. Routes `GET /pending-decision?workspaceId=` and `POST /pending-decision/:source/:id/decide`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/pending-decision/resolve-provider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../../apps/api/src/pending-decision/index";
import type { PendingDecisionProvider } from "../../../apps/api/src/pending-decision/types";

const stub = (source: string): PendingDecisionProvider => ({
  source,
  list: async () => [],
  decide: async () => {},
});

describe("resolveProvider", () => {
  it("finds a registered provider by source", () => {
    const alpha = stub("alpha");
    expect(resolveProvider([alpha, stub("beta")], "alpha")).toBe(alpha);
  });

  it("throws 404 for an unknown source", () => {
    expect(() => resolveProvider([stub("alpha")], "ghost")).toThrow(
      /Unknown pending-decision source/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/pending-decision/resolve-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the routes**

Create `apps/api/src/pending-decision/index.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import workspaceAccess from "../middleware/workspace-access";
import { collectPendingDecisions } from "./collect";
import { providers } from "./registry";
import type { PendingDecisionProvider } from "./types";

type Env = { Variables: { userId: string; workspaceId?: string } };

export function resolveProvider(
  registry: PendingDecisionProvider[],
  source: string,
): PendingDecisionProvider {
  const provider = registry.find((p) => p.source === source);
  if (!provider)
    throw new HTTPException(404, {
      message: `Unknown pending-decision source: ${source}`,
    });
  return provider;
}

function getIp(c: { req: { header(name: string): string | undefined } }) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    null
  );
}

const pendingDecision = new Hono<Env>()
  .get(
    "/",
    describeRoute({
      operationId: "listPendingDecisions",
      tags: ["Pending decisions"],
      description: "Work awaiting the current user's accept or reject",
    }),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { items, failedSources } = await collectPendingDecisions(
        providers,
        userId,
        workspaceId,
      );
      return c.json({ items, failedSources });
    },
  )
  .post(
    "/:source/:id/decide",
    describeRoute({
      operationId: "decidePendingDecision",
      tags: ["Pending decisions"],
      description: "Accept or reject one item of pending work",
    }),
    validator("param", v.object({ source: v.string(), id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        decision: v.picklist(["accepted", "rejected"]),
        reason: v.nullable(v.string()),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const { source, id } = c.req.valid("param");
      const { decision, reason } = c.req.valid("json");
      const provider = resolveProvider(providers, source);
      await provider.decide({
        userId: c.get("userId") as string,
        workspaceId: c.get("workspaceId") as string,
        id,
        decision,
        reason: reason?.trim() || null,
        ip: getIp(c),
      });
      return c.json({ ok: true });
    },
  );

export default pendingDecision;
```

Note: confirm the import path for `workspaceAccess` by checking how `apps/api/src/correspondence/letters.ts` imports it (search the file for `workspaceAccess`) and use the identical path. Do not guess.

- [ ] **Step 4: Mount the router**

In `apps/api/src/index.ts`, add the import beside the other feature routers and mount it next to the existing `api.route(...)` block (around line 590):

```ts
api.route("/pending-decision", pendingDecision);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/pending-decision/resolve-provider.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm --filter @kaneo/api test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pending-decision/index.ts apps/api/src/index.ts tests/api/pending-decision/resolve-provider.test.ts
git commit -m "feat(api): expose the pending-decision list and decide routes"
```

---

### Task 5: Web data layer

**Files:**
- Create: `apps/web/src/fetchers/pending-decision/index.ts`
- Create: `apps/web/src/hooks/queries/pending-decision/use-pending-decisions.ts`
- Create: `apps/web/src/hooks/mutations/pending-decision/use-decide-pending.ts`
- Modify: `apps/web/src/hooks/use-user-websocket.ts:61`
- Test: `apps/web/src/hooks/mutations/pending-decision/invalidations.test.tsx`

**Interfaces:**
- Consumes: the API routes from Task 4
- Produces:
  - `type PendingDecisionItem = { source: string; id: string; title: string; subtitle: string; context: string[]; href: string; createdAt: string; requiresReason: boolean }` — note `createdAt` is a **string** on the wire
  - `class PendingDecisionError extends Error { status: number }`
  - `getPendingDecisions(workspaceId: string): Promise<{ items: PendingDecisionItem[]; failedSources: string[] }>`
  - `decidePending(args: { workspaceId: string; source: string; id: string; decision: "accepted" | "rejected"; reason: string | null }): Promise<void>`
  - `usePendingDecisions(workspaceId: string)` — query key `["pending-decisions", workspaceId]`
  - `useDecidePending(workspaceId: string)` — mutation

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/mutations/pending-decision/invalidations.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDecidePending } from "./use-decide-pending";

const decidePending = vi.fn();
vi.mock("@/fetchers/pending-decision", () => ({
  decidePending: (...args: unknown[]) => decidePending(...args),
}));

describe("useDecidePending", () => {
  beforeEach(() => {
    decidePending.mockReset().mockResolvedValue(undefined);
  });

  it("refreshes every surface that shows the same pending item", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useDecidePending("ws-1"), { wrapper });
    result.current.mutate({
      source: "correspondence",
      id: "l1:a1",
      decision: "accepted",
      reason: null,
    });

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(["pending-decisions", "ws-1"]);
    expect(keys).toContainEqual(["awaiting-acceptance", "ws-1"]);
    expect(keys).toContainEqual(["my-correspondence", "ws-1"]);
  });
});
```

Before writing the implementation, confirm the exact my-correspondence query key by reading `apps/web/src/hooks/queries/correspondence/use-letters.ts`. If it differs from `["my-correspondence", workspaceId]`, use the real one in **both** the test and the hook.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/hooks/mutations/pending-decision/invalidations.test.tsx`
Expected: FAIL — cannot resolve `./use-decide-pending`.

- [ ] **Step 3: Write the fetchers**

Create `apps/web/src/fetchers/pending-decision/index.ts`:

```ts
import { getApiUrl } from "@/fetchers/get-api-url";

export type PendingDecisionItem = {
  source: string;
  id: string;
  title: string;
  subtitle: string;
  context: string[];
  href: string;
  /** ISO string — Date does not survive JSON. */
  createdAt: string;
  requiresReason: boolean;
};

/**
 * Carries the HTTP status, which the dialog needs: a 409 means the item was
 * already decided elsewhere, and that is not an error worth shouting about.
 */
export class PendingDecisionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PendingDecisionError";
    this.status = status;
  }
}

const url = (path: string) => getApiUrl(`pending-decision${path}`);

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new PendingDecisionError(response.status, await response.text());
  return response.json();
}

export async function getPendingDecisions(workspaceId: string): Promise<{
  items: PendingDecisionItem[];
  failedSources: string[];
}> {
  return jsonOrThrow(
    await fetch(url(`?workspaceId=${encodeURIComponent(workspaceId)}`), {
      credentials: "include",
    }),
  );
}

export async function decidePending(args: {
  workspaceId: string;
  source: string;
  id: string;
  decision: "accepted" | "rejected";
  reason: string | null;
}): Promise<void> {
  await jsonOrThrow(
    await fetch(
      url(
        `/${encodeURIComponent(args.source)}/${encodeURIComponent(args.id)}/decide`,
      ),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: args.workspaceId,
          decision: args.decision,
          reason: args.reason,
        }),
      },
    ),
  );
}
```

- [ ] **Step 4: Write the query hook**

Create `apps/web/src/hooks/queries/pending-decision/use-pending-decisions.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getPendingDecisions } from "@/fetchers/pending-decision";

export function usePendingDecisions(workspaceId: string) {
  return useQuery({
    queryKey: ["pending-decisions", workspaceId],
    queryFn: () => getPendingDecisions(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
```

- [ ] **Step 5: Write the mutation hook**

Create `apps/web/src/hooks/mutations/pending-decision/use-decide-pending.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { decidePending } from "@/fetchers/pending-decision";

export function useDecidePending(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      source: string;
      id: string;
      decision: "accepted" | "rejected";
      reason: string | null;
    }) => decidePending({ workspaceId, ...args }),
    // Three surfaces show the same fact — the dialog, the sidebar dot, and the
    // Home card. Leaving any of them stale makes them disagree out loud.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pending-decisions", workspaceId] });
      qc.invalidateQueries({ queryKey: ["awaiting-acceptance", workspaceId] });
      qc.invalidateQueries({ queryKey: ["my-correspondence", workspaceId] });
    },
  });
}
```

`onSettled` rather than `onSuccess` is deliberate: a 409 means someone else changed the data, so a failed decision is exactly when a refetch matters most.

- [ ] **Step 6: Add the websocket invalidation**

In `apps/web/src/hooks/use-user-websocket.ts`, the `letter-assignment` branch (around line 54) currently ends like this:

```ts
            queryClient.invalidateQueries({
              queryKey: ["awaiting-acceptance"],
            });
            return;
```

Add the new key immediately before the `return`:

```ts
            queryClient.invalidateQueries({
              queryKey: ["awaiting-acceptance"],
            });
            // The central dialog reads the same fact from a different route.
            queryClient.invalidateQueries({
              queryKey: ["pending-decisions"],
            });
            return;
```

Note the key has no workspace id here: these invalidations are intentionally prefix-only so whichever workspace is active refetches.

Then extend `apps/web/src/hooks/use-user-websocket.test.tsx` with an assertion that the new key is invalidated on the same event, matching how the existing `["awaiting-acceptance"]` assertion at line 57 is written.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @kaneo/web test`
Expected: PASS, all suites, including the new invalidation test and the extended websocket test.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/fetchers/pending-decision apps/web/src/hooks/queries/pending-decision apps/web/src/hooks/mutations/pending-decision apps/web/src/hooks/use-user-websocket.ts apps/web/src/hooks/use-user-websocket.test.tsx
git commit -m "feat(web): data layer for the central pending-decision queue"
```

---

### Task 6: The dialog and its open rules

**Files:**
- Create: `apps/web/src/hooks/use-pending-dialog-open.ts`
- Create: `apps/web/src/components/pending-decision-dialog.tsx`
- Modify: `apps/web/src/routes/_layout/_authenticated.tsx`
- Modify: `apps/web/src/i18n/en-US.json`
- Test: `apps/web/src/hooks/use-pending-dialog-open.test.ts`
- Test: `apps/web/src/components/pending-decision-dialog.test.tsx`

**Interfaces:**
- Consumes: `usePendingDecisions`, `useDecidePending`, `PendingDecisionError`, `PendingDecisionItem`
- Produces: `shouldAutoOpen(args: { hasPending: boolean; isIdle: boolean; alreadyOpen: boolean; dismissed: boolean }): boolean`; `<PendingDecisionDialog />`

- [ ] **Step 1: Write the failing test for the open rule**

Create `apps/web/src/hooks/use-pending-dialog-open.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isIdleForDialog, shouldAutoOpen } from "./use-pending-dialog-open";

describe("shouldAutoOpen", () => {
  const base = {
    hasPending: true,
    isIdle: true,
    alreadyOpen: false,
    dismissed: false,
  };

  it("opens when work is pending and the user is idle", () => {
    expect(shouldAutoOpen(base)).toBe(true);
  });

  it("stays shut while the user is busy", () => {
    expect(shouldAutoOpen({ ...base, isIdle: false })).toBe(false);
  });

  it("stays shut when nothing is pending", () => {
    expect(shouldAutoOpen({ ...base, hasPending: false })).toBe(false);
  });

  it("does not reopen what the user dismissed", () => {
    expect(shouldAutoOpen({ ...base, dismissed: true })).toBe(false);
  });

  it("does not fight a dialog that is already open", () => {
    expect(shouldAutoOpen({ ...base, alreadyOpen: true })).toBe(false);
  });
});

describe("isIdleForDialog", () => {
  it("is idle when nothing has focus", () => {
    expect(isIdleForDialog(null)).toBe(true);
  });

  it("is busy while focus sits in a text input", () => {
    const input = document.createElement("input");
    expect(isIdleForDialog(input)).toBe(false);
  });

  it("is busy while focus sits in a textarea", () => {
    expect(isIdleForDialog(document.createElement("textarea"))).toBe(false);
  });

  it("is busy inside a contenteditable region", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isIdleForDialog(div)).toBe(false);
  });

  it("is idle when focus is on an ordinary button", () => {
    expect(isIdleForDialog(document.createElement("button"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/hooks/use-pending-dialog-open.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the open rules**

Create `apps/web/src/hooks/use-pending-dialog-open.ts`:

```ts
/**
 * The dialog interrupts, so it must earn the interruption: it waits until the
 * user is not mid-sentence. The dot stays lit in the meantime, and landing on
 * Home brings the dialog back — nothing is lost by waiting.
 */
export function isIdleForDialog(active: Element | null): boolean {
  if (!active) return true;
  const tag = active.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return false;
  if ((active as HTMLElement).isContentEditable) return false;
  return true;
}

export function shouldAutoOpen(args: {
  hasPending: boolean;
  isIdle: boolean;
  alreadyOpen: boolean;
  dismissed: boolean;
}): boolean {
  const { hasPending, isIdle, alreadyOpen, dismissed } = args;
  return hasPending && isIdle && !alreadyOpen && !dismissed;
}
```

Note: `isContentEditable` is a property of `HTMLElement`, not of a bare `Element`, and jsdom sets it from the attribute. If the contenteditable test fails in jsdom, fall back to reading the attribute directly: `active.getAttribute("contenteditable") === "true"`. Make the test pass without weakening what it asserts.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kaneo/web exec vitest run src/hooks/use-pending-dialog-open.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing test for the dialog**

Create `apps/web/src/components/pending-decision-dialog.test.tsx`. Mock the two hooks and the toast module; assert behaviour, never mock internals of the component under test:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendingDecisionError } from "@/fetchers/pending-decision";
import { PendingDecisionDialog } from "./pending-decision-dialog";

const mutate = vi.fn();
const items = {
  current: [
    {
      source: "correspondence",
      id: "l1:a1",
      title: "MAPIM/2026/0114",
      subtitle: "Permohonan kerjasama",
      context: ["Action: For your action"],
      href: "/dashboard/correspondence/l1",
      createdAt: "2026-08-19T00:00:00.000Z",
      requiresReason: true,
    },
  ],
};

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/queries/pending-decision/use-pending-decisions", () => ({
  usePendingDecisions: () => ({
    data: { items: items.current, failedSources: [] },
  }),
}));
vi.mock("@/hooks/mutations/pending-decision/use-decide-pending", () => ({
  useDecidePending: () => ({ mutate, isPending: false }),
}));

const errorToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  toast: { error: (m: string) => errorToast(m), info: vi.fn() },
}));

describe("PendingDecisionDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
    errorToast.mockReset();
    items.current = [
      {
        source: "correspondence",
        id: "l1:a1",
        title: "MAPIM/2026/0114",
        subtitle: "Permohonan kerjasama",
        context: ["Action: For your action"],
        href: "/dashboard/correspondence/l1",
        createdAt: "2026-08-19T00:00:00.000Z",
        requiresReason: true,
      },
    ];
  });

  it("shows the pending item when work is waiting", async () => {
    render(<PendingDecisionDialog />);
    expect(await screen.findByText("MAPIM/2026/0114")).toBeInTheDocument();
    expect(screen.getByText("Permohonan kerjasama")).toBeInTheDocument();
  });

  it("accepts with one click and no reason", async () => {
    render(<PendingDecisionDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /accept/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "l1:a1", decision: "accepted", reason: null }),
      expect.anything(),
    );
  });

  it("will not submit a rejection until a reason is written", async () => {
    render(<PendingDecisionDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /reject/i }));

    const confirm = screen.getByRole("button", { name: /confirm rejection/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "Wrong department");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "rejected",
        reason: "Wrong department",
      }),
      expect.anything(),
    );
  });

  it("treats a 409 as already handled, with no error toast", async () => {
    mutate.mockImplementation((_args, opts) => {
      opts.onError(new PendingDecisionError(409, "already decided"));
    });
    render(<PendingDecisionDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /accept/i }));

    expect(await screen.findByText(/already handled/i)).toBeInTheDocument();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("shouts about a real failure", async () => {
    mutate.mockImplementation((_args, opts) => {
      opts.onError(new PendingDecisionError(500, "boom"));
    });
    render(<PendingDecisionDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /accept/i }));

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
  });

  it("never plays a chime — AppAlerts owns the audio", async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play");
    render(<PendingDecisionDialog />);
    await screen.findByText("MAPIM/2026/0114");
    expect(play).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/components/pending-decision-dialog.test.tsx`
Expected: FAIL — cannot resolve `./pending-decision-dialog`.

- [ ] **Step 7: Write the dialog**

Create `apps/web/src/components/pending-decision-dialog.tsx`:

```tsx
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  type PendingDecisionItem,
  PendingDecisionError,
} from "@/fetchers/pending-decision";
import { useDecidePending } from "@/hooks/mutations/pending-decision/use-decide-pending";
import { usePendingDecisions } from "@/hooks/queries/pending-decision/use-pending-decisions";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  isIdleForDialog,
  shouldAutoOpen,
} from "@/hooks/use-pending-dialog-open";
import { toast } from "@/lib/toast";

const HOME_PATH = "/dashboard/home";

function ItemCard({
  item,
  workspaceId,
  onDone,
}: {
  item: PendingDecisionItem;
  workspaceId: string;
  onDone: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { mutate, isPending } = useDecidePending(workspaceId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [gone, setGone] = useState(false);

  const decide = (decision: "accepted" | "rejected", value: string | null) =>
    mutate(
      { source: item.source, id: item.id, decision, reason: value },
      {
        onSuccess: () => onDone(item.id),
        onError: (error: unknown) => {
          // Losing a footrace is not a failure worth shouting about: someone
          // else already handled this, which is the outcome we wanted anyway.
          if (error instanceof PendingDecisionError && error.status === 409) {
            setGone(true);
            return;
          }
          toast.error(
            error instanceof Error
              ? error.message
              : t("pendingDecisions.genericError"),
          );
        },
      },
    );

  if (gone)
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {t("pendingDecisions.alreadyHandled")}
      </div>
    );

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="font-medium">{item.title}</div>
      <div className="text-sm text-muted-foreground">{item.subtitle}</div>
      {item.context.map((line) => (
        <div key={line} className="text-xs text-muted-foreground">
          {line}
        </div>
      ))}
      <a
        href={item.href}
        className="text-xs underline underline-offset-2 inline-block"
      >
        {t("pendingDecisions.open")}
      </a>

      {rejecting ? (
        <div className="space-y-2 pt-2">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("pendingDecisions.reasonPlaceholder")}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim() || isPending}
              onClick={() => decide("rejected", reason.trim())}
            >
              {t("pendingDecisions.confirmRejection")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRejecting(false)}
            >
              {t("pendingDecisions.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => decide("accepted", null)}
          >
            {t("pendingDecisions.accept")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
            {t("pendingDecisions.reject")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PendingDecisionDialog() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data } = usePendingDecisions(workspace?.id ?? "");
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [decided, setDecided] = useState<string[]>([]);

  const items = (data?.items ?? []).filter((i) => !decided.includes(i.id));
  const failed = data?.failedSources ?? [];

  // Landing on Home clears the dismissal: the dot must never be the only thing
  // standing between someone and a decision they owe.
  const path = location.pathname;
  const lastPath = useRef(path);
  useEffect(() => {
    if (path !== lastPath.current && path === HOME_PATH) setDismissed(false);
    lastPath.current = path;
  }, [path]);

  useEffect(() => {
    if (
      shouldAutoOpen({
        hasPending: items.length > 0,
        isIdle: isIdleForDialog(document.activeElement),
        alreadyOpen: open,
        dismissed,
      })
    )
      setOpen(true);
  }, [items.length, open, dismissed]);

  // The last decision closes the dialog rather than leaving an empty shell.
  useEffect(() => {
    if (open && items.length === 0 && failed.length === 0) setOpen(false);
  }, [open, items.length, failed.length]);

  if (!workspace) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) setDismissed(true);
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("pendingDecisions.title")}</DialogTitle>
          <DialogDescription>
            {t("pendingDecisions.description")}
          </DialogDescription>
        </DialogHeader>
        {failed.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {t("pendingDecisions.partialFailure", {
              sources: failed.join(", "),
            })}
          </div>
        )}
        <div className="space-y-3 overflow-y-auto">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              workspaceId={workspace.id}
              onDone={(id) => setDecided((prev) => [...prev, id])}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Two things to check against the real codebase rather than trusting this listing: that `@/components/ui/textarea` exists with a `value`/`onChange` API (if not, use the project's equivalent), and that `Button` accepts the `variant` values used here. Adjust to the real components; do not invent props.

- [ ] **Step 8: Add the i18n keys**

In `apps/web/src/i18n/en-US.json`, add a `pendingDecisions` block following the file's existing nesting and ordering conventions:

```json
"pendingDecisions": {
  "title": "Waiting for your decision",
  "description": "Accept or reject each item to clear it from your queue.",
  "accept": "Accept",
  "reject": "Reject",
  "confirmRejection": "Confirm rejection",
  "cancel": "Cancel",
  "open": "Open",
  "reasonPlaceholder": "Why are you rejecting this?",
  "alreadyHandled": "Already handled by someone else.",
  "partialFailure": "Couldn't load items from: {{sources}}",
  "genericError": "That didn't go through. Try again."
}
```

- [ ] **Step 9: Mount the dialog**

In `apps/web/src/routes/_layout/_authenticated.tsx`, import `PendingDecisionDialog` and render it directly beneath the existing `<AppAlerts />` at line 27.

- [ ] **Step 10: Wire the sidebar dot**

In `apps/web/src/components/nav-main.tsx`, the Home nav item already renders a dot from `usePendingActions()`. Make clicking it open the dialog. The dialog owns its own `open` state, so expose a module-level opener from `pending-decision-dialog.tsx`:

```ts
let openDialog: (() => void) | null = null;
export function openPendingDecisions() {
  openDialog?.();
}
```

Register it inside the component with `useEffect(() => { openDialog = () => { setDismissed(false); setOpen(true); }; return () => { openDialog = null; }; }, []);` and call `openPendingDecisions()` from the nav item's click handler. A module-level handle rather than context keeps `nav-main.tsx` from taking a dependency on the dialog's internals.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `pnpm --filter @kaneo/web test`
Expected: PASS, all suites including the six new dialog tests and the ten open-rule tests.

- [ ] **Step 12: Prove the tests bite**

Temporarily change the reject button's `disabled={!reason.trim() || isPending}` to `disabled={isPending}`. The "will not submit a rejection until a reason is written" test must fail. Restore.

Temporarily remove the `error.status === 409` branch so every error toasts. The "treats a 409 as already handled" test must fail. Restore.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/components/pending-decision-dialog.tsx apps/web/src/components/pending-decision-dialog.test.tsx apps/web/src/hooks/use-pending-dialog-open.ts apps/web/src/hooks/use-pending-dialog-open.test.ts apps/web/src/routes/_layout/_authenticated.tsx apps/web/src/components/nav-main.tsx apps/web/src/i18n/en-US.json
git commit -m "feat(web): central dialog for work awaiting a decision"
```

---

### Task 7: Integration verification

**Files:**
- Create: `tests/api-integration/pending-decision.test.ts`
- Verify unchanged: `tests/api-integration/correspondence-handover.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4

This task is the proof that Task 1's refactor changed no behaviour, and that the new routes work against a real database.

- [ ] **Step 1: Start a PostgreSQL for the integration suite**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo -p 5433:5432 postgres:16-alpine
```

Read `tests/api-integration/setup.ts` to see exactly which environment variables it sets and which connection string it derives, and match the container's port and credentials to what that file expects. Do not edit `setup.ts`.

- [ ] **Step 2: Run the existing handover suite untouched**

Run: `pnpm --filter @kaneo/api test:integration -- correspondence-handover`
Expected: PASS, with `git diff --stat tests/api-integration/correspondence-handover.test.ts` showing no changes.

If this fails, Task 1's refactor changed behaviour. Fix the refactor, not the test.

- [ ] **Step 3: Write the new integration test**

Create `tests/api-integration/pending-decision.test.ts`. Read `tests/api-integration/correspondence-handover.test.ts` first and reuse its helpers — `createWorkspaceMember`, `grantGeneralManagement`, `mockAuthenticatedSession`, `resetTestDatabase`, and its `captureLetter` pattern. Do not invent new fixtures.

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

describe("API integration: pending decisions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists a routed letter, accepts it, and 409s on a second decision", async () => {
    // Arrange: an officer routes a letter to a clerk, exactly as
    // correspondence-handover.test.ts does. Copy that arrangement verbatim —
    // the assertions below are the new part, not the setup.
    //
    // Act 1: as the clerk, GET /api/pending-decision?workspaceId=<ws>
    // Assert: one item, source "correspondence", requiresReason true, and
    //   id matching /^[^:]+:[^:]+$/ (letterId:assignmentId).
    //
    // Act 2: POST /api/pending-decision/correspondence/<id>/decide with
    //   { workspaceId, decision: "accepted", reason: null }
    // Assert: 200, and a follow-up GET returns zero items.
    //
    // Act 3: POST the same body again.
    // Assert: 409.
  });
});
```

Replace each comment with the real arrangement and assertions. Split into three `it` blocks if the single test grows past roughly forty lines — one behaviour per test reads better than one long script.

- [ ] **Step 4: Run the new suite**

Run: `pnpm --filter @kaneo/api test:integration -- pending-decision`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run everything**

Run: `pnpm test`
Expected: PASS, all turbo tasks.

Run: `pnpm --filter @kaneo/api test:integration`
Expected: PASS, whole integration suite.

- [ ] **Step 6: Tear down the container**

```bash
docker rm -f kaneo-test-pg
```

- [ ] **Step 7: Commit**

```bash
git add tests/api-integration/pending-decision.test.ts
git commit -m "test(api): integration cover for the pending-decision routes"
```

---

## Browser verification (before this branch is called done)

The previous branch shipped a sidebar bell nobody had ever seen render. This one gets checked in a real browser. With the dev server running and two accounts available:

1. Route a letter from one account to another. The recipient's dialog pops, once, with a chime from `AppAlerts` — confirm you hear exactly one sound.
2. Start typing in a text field, have a second letter routed. The dialog must **not** steal focus; the dot lights instead.
3. Navigate to Home. The dialog appears with both items listed and scrollable.
4. Reject one. Confirm the button stays disabled until a reason is typed.
5. Accept the other. Confirm the dialog closes and the sidebar dot clears.
6. With the dialog open in two tabs, accept the same item in both. The second tab must show "Already handled by someone else" with no red toast.

Anything that fails here is a defect in this branch, not a follow-up.
