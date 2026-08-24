# Global Admin Column and GM Admin-Only Pages — Design

**Date:** 2026-08-24
**Status:** Approved for planning

## Problem

Two gaps, both in access control, both small because the machinery mostly
exists already.

1. **General Management's Overview and Settings are visible to anyone with
   the `general-management` page slug.** They are configuration and
   whole-module reporting surfaces; they belong to whoever administers the
   module, not to everyone who handles letters.
2. **There is no way to make someone a global admin from the UI.** The
   `global-admin` role exists and already grants everything, but the only
   way to assign it is through the workspace Roles screen, which is not
   where anyone looks when granting access.

## What already exists — read this before designing anything new

Most of the authority model is built. The work is wiring, not invention.

- `GLOBAL_ADMIN_ROLES = { "owner", "global-admin", "admin" }` in
  `apps/api/src/utils/project-access.ts`. `isGlobalAdmin(userId,
  workspaceId)` resolves a member's workspace role against that set.
- `hasWorkspacePageAccess` (`apps/api/src/utils/page-access.ts`) returns
  true for a global admin **before** consulting the grant matrix. So a
  global admin already has every page in `ACCESS_PAGE_SLUGS` — **and every
  page added later**, with no migration and no backfill. Requirement 2's
  "all current and future pages" is already satisfied by the role; only the
  toggle is missing.
- `GET /workspace-access/:workspaceId/me` short-circuits for a global admin
  and returns every slug with `isAdmin: true`.
- `isGmAdmin` / `assertGmAdmin` (`apps/api/src/correspondence/roles.ts`) is
  the module's configuration-authority check, and it maps to
  `isGlobalAdmin`.
- **Config writes are already admin-only.** Every `POST`/`PUT`/`DELETE`
  registered by `registerConfigResource` calls `assertGmAdmin` inside the
  handler. The `pageAccess` middleware on those routes is an outer gate, not
  the whole story. Only `GET /config/*` and `GET /summary` are
  `pageAccess`-only.
- `access.tsx` already has `ADMIN_ROLES` and an `isAdminRow` flag, and
  renders an admin's page checkboxes as checked-and-disabled. The new column
  follows that existing pattern rather than inventing one.
- Member role writes go through **Better Auth**
  (`authClient.organization.updateMemberRole`); `workspace_member` is Better
  Auth's organization member table.

## Decisions taken during design

- **Enforce server-side, not just in the UI.** Hiding a tab is not an access
  control. Because writes are already gated, this reduces to gating two read
  paths.
- **A demotion restores the member's previous role.** Role is single-valued,
  so promoting a `manager` would otherwise silently strip that role on
  demotion.
- **Owner and `admin` render checked and disabled.** They already hold
  global-admin authority; showing it is honest, and locking it prevents
  demoting the workspace owner and stranding the workspace.
- **The toggle does not go through Better Auth.** Role and previous-role must
  change together or not at all.

## 1. Restricting GM Overview and Settings

### Server — the actual boundary

Two reads move from `pageAccess` to `assertGmAdmin`:

- `GET /config/*` — every list route registered by `registerConfigResource`
  in `apps/api/src/correspondence/index.ts`. One change inside that function
  covers every config resource, because they are all registered through it.
- `GET /summary` in `apps/api/src/correspondence/letters.ts`, which backs
  the Overview dashboard.

Everything else in the module — letter registers, capture, minutes,
attachments, outgoing, retention, reports — keeps `pageAccess` untouched. A
non-admin with GM access continues to do all letter work exactly as before.

**This locks nobody out of anything they can do today.** Config mutation
already required `assertGmAdmin`; only reading config and the dashboard
summary changes hands.

### Web

`gm-shell.tsx` renders `SECTIONS` — Overview, Correspondence, Settings.
Show Overview and Settings only when the viewer is a global admin, via
`useWorkspacePermission().isAdmin`, which resolves `owner | admin |
global-admin` — the same set as `GLOBAL_ADMIN_ROLES`.

A non-admin arriving at a hidden section (a stale link, a bookmark) must
land on Correspondence rather than an empty shell. This is display
convenience; the server checks above are the real gate.

## 2. The Global Admin column

### Schema

`workspace_member` gains one nullable column:

```
previousRole  text  NULL
```

Null means "never promoted through this control", which is also every
existing row — the column grandfathers itself with no backfill. Better Auth
ignores columns it does not know about.

### The endpoint

`PUT /workspace-access/:workspaceId/global-admin`, body `{ userId, enabled }`,
actor must satisfy `isGlobalAdmin`.

- **enable** — write the member's current `role` into `previousRole`, set
  `role = "global-admin"`.
- **disable** — set `role = previousRole ?? "member"`, clear `previousRole`.
- **owner is refused** with 403. Demoting the owner is never correct.
- **already in the target state is a no-op**, so a double-click cannot
  overwrite `previousRole` with `"global-admin"` and strand the member's
  real role. This is the failure this endpoint most needs to avoid.
- Writes an audit event, as the existing matrix toggle does.

Both fields change in one statement so a partial write is impossible.

**Identify the member by `userId`, not by a membership row id.** The
`/workspace/:id/members` payload's `id` is `userTable.id` (it selects `id:
userTable.id`), and the existing `setPageAccess` call already passes
`member.id` as `userId`. The neighbouring
`useUpdateWorkspaceUserRole` hook passes a `memberId` to Better Auth, which
is a *different* identifier — do not copy that call's shape. Scoping the
update by `(workspaceId, userId)` sidesteps the ambiguity.

### Web

A leading **Global Admin** column in
`routes/_layout/_authenticated/dashboard/settings/workspace/access.tsx`,
before the page columns and after the member cell.

- `owner` and `admin` rows: checked, disabled — matching the existing
  `isAdminRow` treatment of the page columns.
- Everyone else: editable, checked when `role === "global-admin"`.
- When a row is checked, that row's per-page checkboxes go disabled: the
  role grants every page, so the individual grants are not what is in
  effect, and offering them would misrepresent what is happening.

## Migration

One additive migration: `ALTER TABLE "workspace_member" ADD COLUMN
"previous_role" text;`. No backfill — null is the correct value for every
existing row.

## Testing

**Unit (pure):** the demote-target rule — `previousRole ?? "member"` — and
the no-op guard, extracted so they can be tested without a database.

**API integration:**
- A non-admin GM member gets 403 on `GET /config/*` and on `GET /summary`,
  and still gets 200 on a letters route. That pair is the whole point: the
  boundary moved for config, not for letter work.
- Promote a `manager`, demote, confirm the role is `manager` again and
  `previousRole` is null.
- Promote a member whose `previousRole` is null, demote, confirm `member`.
- Enabling twice leaves `previousRole` at the original role, not
  `"global-admin"`.
- Promoting grants every page slug through `GET /workspace-access/:id/me`,
  including one the member had no explicit grant for.
- The owner is refused, and a non-admin actor is refused.

**Web:** the column renders checked-and-disabled for an owner row and
editable for a member row; GM tabs hide for a non-admin.

## Out of scope

- Finer-grained General Management roles (registry, approver, signatory,
  records-manager, auditor). `isGmAdmin` still maps to `isGlobalAdmin`.
- Per-page admin. Global admin remains all-or-nothing by design — that is
  what makes "all future pages" free.
- Reworking how Better Auth stores roles.
- Any change to the Roles screen, where `global-admin` is already
  assignable.
