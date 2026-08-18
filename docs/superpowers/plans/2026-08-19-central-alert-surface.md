# Central Alert Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any module that calls `createNotification` gets a bell entry, a toast and a chime with no UI code of its own, and the "awaits your decision" dot stops being correspondence-specific.

**Architecture:** The app already has a general notification spine — `notificationTable` via `createNotification`, read by `useGetNotifications()` (query key `["notifications"]`), already live-pushed by the user socket. Its renderer, `notification-dropdown.tsx`, is complete but never mounted. This work mounts it, drives toast and chime from that same query, and replaces correspondence's private alert path with a shared one. A separate hook composes "pending actions" for the dot, keeping *something happened* distinct from *you must act*.

**Tech Stack:** React 19, TanStack Query, sonner (via `@/lib/toast`), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-19-central-alert-surface-design.md`

## Global Constraints

- No API change. Every task is read-only against the notification endpoints.
- Every notification interrupts — no per-type filtering, no user preference beyond the existing per-device mute.
- The seen-set replay guard is load-bearing: the FIRST non-undefined list seeds silently. Never pass `?? []` to an alert hook — seeding an empty set announces the entire first list on every page load.
- The chime is `/chime.wav` (no MP3 encoder exists on this project's machines).
- Do not change `notification/feed`, the Home activity feed, or the existing Home `bellCount`. They are a separate, task-only system.
- Biome style: double quotes, semicolons, spaces for indentation in TS/TSX. Run `npx biome check --write <files>` before committing.
- Commands from the repo root: `pnpm --filter @kaneo/web test`, `pnpm --filter @kaneo/web build`, `pnpm test`.
- Baseline that must not regress: web unit 56 tests, API unit 209.
- `pnpm --filter @kaneo/web typecheck` reports 74 PRE-EXISTING errors repo-wide. They are not yours. Add none.

---

### Task 1: Generalise the alert hook

**Files:**
- Create: `apps/web/src/hooks/use-notification-alerts.ts`
- Test: `apps/web/src/hooks/use-notification-alerts.test.ts`
- (Task 2 deletes `apps/web/src/hooks/use-assignment-alerts.ts` and its test — not this task, or the build breaks mid-plan)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `unseenIds(seen: Set<string>, items: { id: string }[]): string[]`
  - `useUnseenAlerts<T extends { id: string }>(items: T[] | undefined, onUnseen: (items: T[]) => void): void` — note `onUnseen` receives the WHOLE batch, not one item. That is what makes coalescing possible in Task 2.

The existing `use-assignment-alerts.ts` does the same job for one item at a time. Copy its structure and its comments; the only real changes are the generic type and the batch callback.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/hooks/use-notification-alerts.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { unseenIds, useUnseenAlerts } from "./use-notification-alerts";

const item = (id: string) => ({ id });

describe("unseenIds", () => {
  it("reports an id the user has not seen", () => {
    expect(unseenIds(new Set(["a"]), [item("a"), item("b")])).toEqual(["b"]);
  });

  it("reports nothing when everything is already seen", () => {
    expect(unseenIds(new Set(["a", "b"]), [item("a"), item("b")])).toEqual([]);
  });
});

describe("useUnseenAlerts", () => {
  it("stays silent on the first list, however long it is", () => {
    const onUnseen = vi.fn();
    renderHook(() =>
      useUnseenAlerts([item("a"), item("b"), item("c")], onUnseen),
    );
    expect(onUnseen).not.toHaveBeenCalled();
  });

  it("stays silent while the query is loading, then seeds on the first real list", () => {
    const onUnseen = vi.fn();
    const { rerender } = renderHook(
      ({ items }) => useUnseenAlerts(items, onUnseen),
      { initialProps: { items: undefined as { id: string }[] | undefined } },
    );
    rerender({ items: undefined });
    rerender({ items: [item("a"), item("b")] });
    expect(onUnseen).not.toHaveBeenCalled();
  });

  it("delivers a burst as ONE call carrying every new item", () => {
    // This is what lets the caller chime once for five notifications.
    const onUnseen = vi.fn();
    const { rerender } = renderHook(
      ({ items }) => useUnseenAlerts(items, onUnseen),
      { initialProps: { items: [item("a")] } },
    );
    rerender({ items: [item("a"), item("b"), item("c"), item("d")] });
    expect(onUnseen).toHaveBeenCalledTimes(1);
    expect(onUnseen.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("announces each item only once across renders", () => {
    const onUnseen = vi.fn();
    const { rerender } = renderHook(
      ({ items }) => useUnseenAlerts(items, onUnseen),
      { initialProps: { items: [item("a")] } },
    );
    rerender({ items: [item("a"), item("b")] });
    rerender({ items: [item("a"), item("b")] });
    expect(onUnseen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run --config vitest.config.ts src/hooks/use-notification-alerts.test.ts`
Expected: FAIL — cannot resolve `./use-notification-alerts`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/hooks/use-notification-alerts.ts
import { useEffect, useRef } from "react";

export function unseenIds(
  seen: Set<string>,
  items: { id: string }[],
): string[] {
  return items.filter((i) => !seen.has(i.id)).map((i) => i.id);
}

/**
 * Announces items the user has not seen yet. The seen set is seeded from the
 * first list received, so a page load or a socket reconnect stays silent and
 * only genuinely new work interrupts anyone.
 *
 * The callback receives the whole batch rather than one item at a time: a
 * burst of notifications should cost one chime, not one per item.
 */
export function useUnseenAlerts<T extends { id: string }>(
  items: T[] | undefined,
  onUnseen: (items: T[]) => void,
) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const ids = unseenIds(seen.current, items);
    if (ids.length === 0) return;
    for (const id of ids) seen.current.add(id);
    onUnseen(items.filter((i) => ids.includes(i.id)));
  }, [items, onUnseen]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command.
Expected: PASS — 6 tests.

- [ ] **Step 5: Prove the seeding guard bites**

Temporarily replace `new Set(items.map((i) => i.id))` with `new Set()`, re-run,
and confirm "delivers a burst as ONE call carrying every new item" FAILS
(it will report 4 items, not 3). Restore the line and confirm green again.
Report both runs. A guard no test can break is not a guard.

- [ ] **Step 6: Leave the old hook in place**

Do NOT delete `use-assignment-alerts.ts` yet. `correspondence-alerts.tsx` still
imports it, and deleting it here would leave this commit unable to build. Task 2
removes the component and the old hook together, so every commit stays green.

Confirm the build passes before committing:
`pnpm --filter @kaneo/web build`

- [ ] **Step 7: Commit**

```bash
npx biome check --write apps/web/src/hooks/use-notification-alerts.ts apps/web/src/hooks/use-notification-alerts.test.ts
git add -A
git commit --no-verify -m "refactor(web): generalise the unseen-item alert hook"
```

---

### Task 2: Alerts from the notification spine

**Files:**
- Create: `apps/web/src/components/app-alerts.tsx`
- Delete: `apps/web/src/components/correspondence-alerts.tsx`
- Modify: `apps/web/src/routes/_layout/_authenticated.tsx` (swap the mounted component)

**Interfaces:**
- Consumes: `useUnseenAlerts` (Task 1); `useGetNotifications` (default export of `@/hooks/queries/notification/use-get-notifications`); `createChime` from `@/lib/play-chime`; `useChimePreference` from `@/hooks/use-chime-preference`; `toast` from `@/lib/toast`.
- Produces: `<AppAlerts />` — no props, mounted once.

A notification row has this shape (from `notificationTable`): `id: string`,
`title: string | null`, `content: string | null`, `type: string`,
`isRead: boolean | null`, `resourceId: string | null`,
`resourceType: string | null`, `createdAt`.

`correspondence-alerts.tsx` already solves the two hard parts — a single
`Audio` element read through a ref so a mute toggle does not discard the
unlocked element, and spending the first user gesture on an inaudible unlock
because browsers refuse audio before one. Copy both, with their comments.

- [ ] **Step 1: Create the component**

```tsx
// apps/web/src/components/app-alerts.tsx
import { useCallback, useEffect, useMemo, useRef } from "react";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { useChimePreference } from "@/hooks/use-chime-preference";
import { useUnseenAlerts } from "@/hooks/use-notification-alerts";
import { createChime } from "@/lib/play-chime";
import { toast } from "@/lib/toast";

type Notified = { id: string; title: string | null; type: string };

/**
 * Mounted once for the whole app. Every module that calls createNotification
 * on the API gets a toast and a chime from here — no module writes alert code
 * of its own.
 */
export function AppAlerts() {
  const { data } = useGetNotifications();
  const { muted } = useChimePreference();

  // One Audio element for the session, read through a ref: rebuilding it on
  // every mute toggle would throw away the element the unlock below primed.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const chime = useMemo(
    () =>
      createChime({
        isMuted: () => mutedRef.current,
        audio: new Audio("/chime.wav"),
      }),
    [],
  );

  // Browsers refuse audio until the page has seen a user gesture, so the first
  // real chime of a session would be swallowed. Spend the first click on an
  // inaudible unlock instead.
  const unlockedRef = useRef(false);
  useEffect(() => {
    if (unlockedRef.current) return;
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      chime.unlock();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [chime]);

  const onUnseen = useCallback(
    (items: Notified[]) => {
      // One chime per burst, never one per item.
      chime.play();
      if (items.length === 1) {
        const only = items[0];
        toast.info(only.title ?? only.type);
        return;
      }
      toast.info(`${items.length} new notifications`);
    },
    [chime],
  );

  // Map rather than cast: `data` comes from the hono client, whose inferred
  // row type carries more fields and may serialise them differently. Mapping
  // to exactly what the alert needs keeps this honest if that type shifts.
  const items = useMemo(
    () =>
      data?.map((n) => ({
        id: String(n.id),
        title: n.title ?? null,
        type: n.type,
      })) as Notified[] | undefined,
    [data],
  );

  // Never default to [] here: the hook seeds its "seen" set from the first
  // non-undefined list. Passing [] while the query is loading would seed an
  // empty set, then announce every existing notification as new.
  useUnseenAlerts(items, onUnseen);

  return null;
}
```

- [ ] **Step 2: Swap the mount**

In `apps/web/src/routes/_layout/_authenticated.tsx`, replace the
`<CorrespondenceAlerts />` element and its import with `<AppAlerts />` from
`@/components/app-alerts`. Leave `useUserWebSocket()` exactly as it is.

- [ ] **Step 3: Delete the old component and the hook it used**

Both go together, so this commit builds:

```bash
git rm apps/web/src/components/correspondence-alerts.tsx \
       apps/web/src/hooks/use-assignment-alerts.ts \
       apps/web/src/hooks/use-assignment-alerts.test.ts
```

- [ ] **Step 4: Verify the tree compiles and the suites pass**

Run: `pnpm --filter @kaneo/web build` then `pnpm --filter @kaneo/web test`
Expected: build succeeds; web unit tests total **56** — the 6 deleted
assignment-alert tests are replaced one-for-one by the 6 added in Task 1. If you
get a different number, stop and work out why before continuing.

- [ ] **Step 5: Verify by hand**

Run `pnpm dev`. Sign in, click once anywhere (to spend the unlock), then have
the API write a notification — the simplest route is to assign a letter to
yourself from another browser, or trigger any existing `createNotification`
path. Confirm exactly one toast and one chime. Say plainly in your report
whether you did this and what you observed.

- [ ] **Step 6: Commit**

```bash
npx biome check --write apps/web/src/components/app-alerts.tsx apps/web/src/routes/_layout/_authenticated.tsx
git add -A
git commit --no-verify -m "feat(web): toast and chime for every notification, not just correspondence"
```

---

### Task 3: Mount the bell, and move the mute to it

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx:38-40`
- Modify: `apps/web/src/components/nav-main.tsx` (remove the mute button and its now-unused imports)

**Interfaces:**
- Consumes: `NotificationDropdown` (default export of `@/components/notification/notification-dropdown`); `useChimePreference`.
- Produces: nothing later tasks depend on.

`notification-dropdown.tsx` is complete and working but has never been mounted:
it renders title, content and relative time, styles unread rows, marks all
read, clears all, and registers a keyboard shortcut. Its type switch falls back
to the stored `title` for unknown types, so `letter_assigned` and `asset_*`
display correctly with no change to it. Do not modify that file.

- [ ] **Step 1: Mount the dropdown beside the workspace switcher**

In `app-sidebar.tsx`, change:

```tsx
      <SidebarHeader className="pt-1 pb-1.5">
        <WorkspaceSwitcher />
      </SidebarHeader>
```

to put the switcher and the bell on one row, the switcher taking the free
space:

```tsx
      <SidebarHeader className="pt-1 pb-1.5">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher />
          </div>
          <NotificationDropdown />
          <ChimeMuteButton />
        </div>
      </SidebarHeader>
```

- [ ] **Step 2: Add the mute button beside the bell**

Create it in the same file, above the sidebar component, so the bell and its
mute live together:

```tsx
function ChimeMuteButton() {
  const { muted, setMuted } = useChimePreference();
  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={muted ? "Unmute notification chime" : "Mute notification chime"}
      title={muted ? "Chime muted" : "Chime on"}
      onClick={() => setMuted(!muted)}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-accent-foreground"
    >
      {muted ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </button>
  );
}
```

Import `Volume2` and `VolumeX` from `lucide-react`, `useChimePreference` from
`@/hooks/use-chime-preference`, and `NotificationDropdown` from
`@/components/notification/notification-dropdown`.

- [ ] **Step 3: Remove the old mute from nav-main**

Delete the mute `<button>` block from `nav-main.tsx` (it renders `VolumeX` /
`Volume2` and calls `setMuted`), plus the now-unused `useChimePreference`
import and the `Volume2` / `VolumeX` imports. Leave everything else in that
file alone — the dot is Task 4.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @kaneo/web build` then `pnpm --filter @kaneo/web test`
Expected: both pass, and biome reports no unused imports in `nav-main.tsx`.

- [ ] **Step 5: Verify by hand**

Run `pnpm dev`. Confirm the bell appears in the sidebar header, opens, and
lists notifications — including any `letter_assigned` or `asset_*` rows already
in your database. Confirm the mute toggle sits beside it and still silences the
chime. Report what you saw, and say so plainly if the layout needs adjusting.

- [ ] **Step 6: Commit**

```bash
npx biome check --write apps/web/src/components/app-sidebar.tsx apps/web/src/components/nav-main.tsx
git add -A
git commit --no-verify -m "feat(web): mount the notification bell in the sidebar"
```

---

### Task 4: The pending-actions dot

**Files:**
- Create: `apps/web/src/hooks/use-pending-actions.ts`
- Test: `apps/web/src/hooks/use-pending-actions.test.ts`
- Modify: `apps/web/src/components/nav-main.tsx`

**Interfaces:**
- Consumes: `useMyCorrespondence` from `@/hooks/queries/correspondence/use-letters`; `useActiveWorkspace` (default export of `@/hooks/queries/workspace/use-active-workspace`).
- Produces:
  - `type PendingActionSource = "correspondence"`
  - `pendingSources(counts: Record<PendingActionSource, number>): PendingActionSource[]`
  - `usePendingActions(): { sources: PendingActionSource[]; hasAny: boolean }`

This is deliberately NOT a registration API. With one producer, a registry is
machinery with no second customer, and it would scatter the answer to "what
counts as awaiting your decision" across the codebase. Adding a module means
adding one line to `usePendingActions`.

It returns the sources rather than a bare boolean so that a future module whose
work lives outside Home can move or split the dot without a rewrite.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/hooks/use-pending-actions.test.ts
import { describe, expect, it } from "vitest";
import { pendingSources } from "./use-pending-actions";

describe("pendingSources", () => {
  it("names a source with work waiting", () => {
    expect(pendingSources({ correspondence: 3 })).toEqual(["correspondence"]);
  });

  it("names nothing when a source is empty", () => {
    expect(pendingSources({ correspondence: 0 })).toEqual([]);
  });

  it("ignores a negative or nonsense count rather than lighting the dot", () => {
    expect(pendingSources({ correspondence: -1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run --config vitest.config.ts src/hooks/use-pending-actions.test.ts`
Expected: FAIL — cannot resolve `./use-pending-actions`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/hooks/use-pending-actions.ts
import { useMyCorrespondence } from "@/hooks/queries/correspondence/use-letters";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/** Add a module here when it has work that awaits a user's decision. */
export type PendingActionSource = "correspondence";

export function pendingSources(
  counts: Record<PendingActionSource, number>,
): PendingActionSource[] {
  return (Object.keys(counts) as PendingActionSource[]).filter(
    (key) => counts[key] > 0,
  );
}

/**
 * "Something awaits your decision" — distinct from the notification bell,
 * which says "something happened". This clears when the user acts, not when
 * they read.
 */
export function usePendingActions() {
  const { data: workspace } = useActiveWorkspace();
  const { data: mine } = useMyCorrespondence(workspace?.id ?? "");

  const sources = pendingSources({
    correspondence: mine?.pendingAssignments?.length ?? 0,
  });
  return { sources, hasAny: sources.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command.
Expected: PASS — 3 tests.

- [ ] **Step 5: Point nav-main at the hook**

In `nav-main.tsx`, replace the direct correspondence read:

```tsx
  const { data: mine } = useMyCorrespondence(workspace?.id ?? "");
  ...
  const hasPendingAssignments = (mine?.pendingAssignments?.length ?? 0) > 0;
```

with:

```tsx
  const { hasAny: hasPendingActions } = usePendingActions();
```

and set the Home item's `hasDot: hasPendingActions`. Remove the now-unused
`useMyCorrespondence` import. Leave the dot's markup — including its
`role="status"` and `aria-label` — exactly as it is.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @kaneo/web build`, `pnpm --filter @kaneo/web test`, `pnpm test`
Expected: all pass. Confirm `pnpm --filter @kaneo/web typecheck` still reports
exactly 74 errors — no more.

- [ ] **Step 7: Commit**

```bash
npx biome check --write apps/web/src/hooks/use-pending-actions.ts apps/web/src/hooks/use-pending-actions.test.ts apps/web/src/components/nav-main.tsx
git add -A
git commit --no-verify -m "feat(web): compose the pending-actions dot from one hook"
```

---

## Done when

- `pnpm test` and `pnpm --filter @kaneo/web build` are green, and typecheck reports no more than the 74 pre-existing errors.
- The notification bell is visible in the sidebar and lists notifications written by assets and correspondence.
- A new notification produces one toast and one chime; five at once produce one of each.
- A page reload produces neither.
- The Home dot still lights for a pending correspondence assignment and clears when it is accepted.
