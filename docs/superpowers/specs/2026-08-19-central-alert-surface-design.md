# A central alert surface: bell, toast, chime, and a pending-actions dot

**Date:** 2026-08-19
**Status:** Approved for implementation
**Module:** apps/web (cross-cutting), apps/api/src/notification (read-only)

## Problem

Correspondence built its own alert path — a toast, a chime, and a dot on Home —
driven by its own `pendingAssignments` query. Nothing else in the app can use
any of it.

Meanwhile the app already has two notification systems:

| Source | Written by | Surfaced |
|---|---|---|
| `notification/feed` (task types only) | task flows | Home activity feed, Home bell count |
| `notificationTable` via `createNotification` (arbitrary `type`, `resourceId`, `resourceType`) | assets, tasks, correspondence | `notification-dropdown.tsx` — **never mounted** |

The second is the general spine. Three modules already write to it, and its
renderer is a complete 316-line component that nothing imports. Every
`letter_assigned`, `asset_renewal_reminder` and `asset_maintenance_due`
notification ever written has therefore been invisible.

## Goals

1. Any module that calls `createNotification` gets a bell entry, a toast and a
   chime without writing UI code.
2. The "something awaits your decision" dot stops being correspondence-specific.
3. The two signals stay distinct: *something happened* is not *you must act*.

## Non-goals

- Per-type or per-user notification preferences. Every notification interrupts;
  this was chosen deliberately over a curated list.
- Making notifications clickable. `resourceId`/`resourceType` stay unused here.
- Changing the task-only `notification/feed`, the Home activity feed, or the
  existing Home bell count.
- Any API change. This work is read-only against the notification endpoints.

## Decisions

| Question | Decision |
|---|---|
| One mechanism or two? | Two, kept distinct: alerts from notifications, dot from pending actions. |
| Which notifications interrupt? | All of them. |
| How far does scope go? | Mount the dark renderer as well as wiring the alerts. |
| Registry for pending actions? | No — one composing hook. A registration API has no second customer yet. |

## The notification spine

`useGetNotifications()` (query key `["notifications"]`) becomes the single
source for the bell, the toast and the chime. It is already live-pushed: the
user socket invalidates that key on `entity: "notification"`
(`use-user-websocket.ts:50`), so no polling is added.

- **Mount `<NotificationDropdown />`** in `app-sidebar.tsx`'s `SidebarHeader`,
  beside the `WorkspaceSwitcher` (line 38-40) — the only existing control
  cluster in the sidebar chrome, and always visible regardless of route. The
  chime mute added earlier sits in `nav-main.tsx`; it moves here too, so a
  user finds the bell and its mute in one place rather than two. It renders
  title,
  content and relative time, marks read, clears, and carries a keyboard
  shortcut. Its type switch falls back to the stored `title` for unknown
  types, so newer types display correctly with no change.
- **`use-notification-alerts.ts`**, generalised from `use-assignment-alerts.ts`.
  The first list received seeds the seen set silently, so a page load or a
  socket reconnect announces nothing. After that, each unseen id announces once.
- **Coalescing.** A burst is whatever arrives between two renders of the
  query — in practice one socket push or one refetch. One unseen item toasts
  with its own title; two or more toast once as "N new notifications". Either
  way the chime plays exactly once per burst. Everything still interrupts;
  nothing machine-guns.
- **`CorrespondenceAlerts` is deleted.** Correspondence becomes one producer
  among several.

`play-chime.ts` and `use-chime-preference.ts` are already generic and move
unchanged.

## The pending-actions dot

One hook, `use-pending-actions.ts`, composes the sources that exist and reports
which are non-empty. Today that is correspondence's `pendingAssignments`.
Adding a module means adding a line there.

It returns the pending sources, not a bare boolean. The dot sits on the Home
nav item because that is where pending correspondence surfaces; a future
module whose work lives elsewhere will need the dot to move or split, and
returning sources makes that a change of rendering rather than a rewrite.

`nav-main.tsx` reads this hook instead of reaching into correspondence.

## Testing

`use-notification-alerts` gets renderHook tests covering the seeding case and
the burst case — five notifications at once must produce exactly one chime.
`use-pending-actions` gets a unit test. The dropdown mount is verified by eye:
mounting `NavMain` requires sidebar, i18n and router scope, and no test in this
repo establishes that pattern.

## Risks

**A backlog appears on deploy.** Every generic notification ever written
becomes visible at once. Users may open the bell to a long history.

**Everything interrupts.** The per-device mute and the coalescing blunt this,
but if comment traffic proves noisy the remedy is a list of interruptive types
— a small change, not a redesign.

**Nothing is clickable.** A toast says something happened; neither it nor the
bell navigates to the thing. This is the obvious next piece of work.
