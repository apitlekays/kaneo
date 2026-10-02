# Asset disposal (Pelupusan) approval — design

**Date:** 2026-10-01. **Status:** approved 2026-10-02 (with the committees
directory added to Phase 1).
**Module:** Asset Management (`registered_asset`, `asset_disposal`).

## Requirement

Disposing of an asset goes through three stages:

1. The asset's **custodian** proposes it for disposal, with a written
   justification and confirmation steps that guard against disposing of a
   good item.
2. A **committee** considers it; the committee **chair** supports or does
   not support the proposal, with a justification. Not supported → the
   asset is released back to normal and the custodian is told why.
   Supported → it goes to the CEO.
3. The **CEO** sees the proposal, who supported it and every justification,
   and approves or rejects it, with a justification.

Requests appear on each decider's Home. This needs a minimal
organisational structure so the app knows who the CEO and the chair are.

## Decisions (answered 2026-10-01)

1. **Approval required.** An asset can only be recorded as disposed after
   CEO approval. Global admins keep an audited override for historical
   records.
2. **Proposer:** the current custodian; for an asset with no custodian,
   any Asset Management page holder may propose on its behalf.
3. **Nobody decides their own proposal.** Chair is the proposer → the
   committee secretary decides. CEO is the proposer → the acting CEO
   decides. Chair and CEO being the same person is allowed (two steps).
4. **Three stages for every asset**, regardless of value. No inspection
   board, no thresholds.

## Current state (verified)

- Roles are owner / global-admin / viewer only — no notion of "CEO".
- Committees exist in Meeting Minutes: `meeting_body` with
  `meeting_body_member.role` = `chair | secretary | member`. None are
  configured in production yet.
- `asset_disposal` records a *physical* disposal (method, date, proceeds)
  and immediately sets `status = disposed`, with no approval.
- The central pending-decision dialog (`pending-decision/`) gathers
  accept/decline work from tasks, letters and meeting actions onto Home;
  its contract requires a reason only on decline and uses fixed labels.

## Design

### Phase 1 — committees directory and positions

**There is no committee screen today.** The Meeting Minutes API has
committees ("bodies") and members (chair / secretary / member, linked
account or external name), but no UI was ever built, so production has
none. Phase 1 adds it.

**General Management → Committees** (new section, visible to every
General Management page holder; **editable by global admins only** —
decided 2026-10-02):
- committee list: name, description, quorum note, active/inactive;
- members: a workspace user or an external name, role chair / secretary /
  member, deactivate (never delete — history keeps pointing at them);
- the API gains a member update route (change role, reactivate) and
  returns member names and avatars;
- **Office holders** card on the same page: CEO and acting CEO.

Positions:

**`workspace_position`**: id, workspace_id, key (`ceo`, unique per
workspace), label ("Chief Executive Officer"), holder_user_id,
acting_user_id (nullable), timestamps.

**`asset_disposal_setting`** (one row per workspace): committee_body_id →
`meeting_body` (the disposal committee), timestamps.

- General Management → Committees → **Office holders**: set the CEO and
  an acting CEO.
- Asset Management → **Disposal settings**: pick the disposal committee
  from existing committees; its chair (and secretary) come from that
  committee's membership.
- Global admins only may edit either.

Resolution, used everywhere:
- **Chair** = active `chair` member of the configured committee with a
  linked account; **secretary** likewise.
- **CEO** = position holder. **Acting CEO** = `acting_user_id`.
- A proposal cannot be made while either is unresolved; the error says
  exactly what to configure.

### Phase 2 — the workflow

**`asset_disposal_request`**: id, asset_id, workspace_id, status,
reason_category, proposed_by, created_at, updated_at, decided_at.
One open request per asset (partial unique index on asset_id where status
is open).

**`asset_disposal_step`** (append-only audit trail): id, request_id,
stage (`proposed | chair | ceo | withdrawn | recorded`), actor_user_id,
outcome (`proposed | supported | not_supported | approved | rejected |
withdrawn`), justification (required, non-empty), acted_as
(`chair | secretary | ceo | acting_ceo | custodian | page_admin`),
created_at. No update or delete route.

Status machine:

```
proposed ──chair: supported──► awaiting_ceo ──ceo: approved──► approved ──record disposal──► disposed
   │                               │
   ├─chair: not supported──► not_supported (closed, asset released)
   ├─custodian: withdraw──► withdrawn (closed, asset released)
                                   └─ceo: rejected──► rejected (closed, asset released)
```

Asset status follows the request: `pending-disposal` while
`proposed | awaiting_ceo`, `approved-for-disposal` once approved,
`disposed` once the physical disposal is recorded, back to its previous
status (`active` / `in-maintenance`) when closed without disposal.

**Stage 1 — propose.** Allowed for the custodian, or a page holder when the
asset has none. Rejected for an asset already disposed, retired, on rent,
or with an open request. The dialog requires:
- a reason category: beyond economical repair · obsolete · damaged ·
  lost · surplus;
- a justification of at least 30 characters;
- ticking "I confirm this item is no longer serviceable for the
  organisation";
- typing the asset's serial number (the existing `TypedConfirmDialog`).

The proposer may **withdraw** until the chair decides.

**Stage 2 — chair.** The decider (chair, or secretary when the chair is
the proposer) gets a pending decision: *Support* / *Do not support*, a
justification required either way. Not supported → closed, asset
released, proposer notified with the justification.

**Stage 3 — CEO.** The decider (CEO, or acting CEO when the CEO is the
proposer) gets a pending decision showing the asset, the proposer's
category and justification, and who supported it with their
justification. *Approve* / *Reject*, justification required. Rejected →
closed, asset released, proposer and chair notified.

**After approval.** "Record disposal" (method, date, proceeds — the
existing `asset_disposal` form) becomes available, and is the only path
to `disposed`. It closes the request. Global admins can still record a
disposal directly as an **override**; it is logged as an
`asset_disposal_step` with stage `recorded`, acted_as `override`, and a
required justification.

### Home, notifications, email

- New pending-decision provider **`asset-disposal`** listing chair-stage
  and CEO-stage requests for whoever must decide.
- The pending-decision contract gains two optional fields, additive and
  backward compatible: `labels: { accept, reject }` and
  `reasonRequired: "reject" | "always"` (default `"reject"`, today's
  behaviour).
- Notifications (in-app, Home bell, and **email** — added to
  `EMAIL_NOTIFICATION_TYPES` as offers/assignments):
  `asset_disposal_review` (to the chair-stage decider),
  `asset_disposal_approval` (to the CEO-stage decider),
  `asset_disposal_outcome` (to the proposer on every close; to the chair
  on CEO rejection).
- Resource type `asset`, so delivery already resolves workspace and link.

### UI

- Asset detail → **Disposal** panel: current request with a timeline of
  every step (who, as what, when, justification); *Propose disposal* /
  *Withdraw* / *Record disposal* as the state allows.
- Asset list: status badges *Proposed for disposal* and *Approved for
  disposal*.
- Asset Management → **Disposal proposals** view: all open and recent
  requests by stage, printable/exportable as the committee paper.

## Release

Additive migration (four new tables). Locking direct disposal behind
approval removes a capability staff use today, so per the versioning rules
this is **4.0.0 (major)**; the deploy note must tell asset managers that
disposal now needs approval, and that positions and the disposal committee
must be configured first.

Rollback: an older image ignores the new tables and statuses it does not
know; assets in `pending-disposal` / `approved-for-disposal` would display
an unknown status there. Reset them to `active` before rolling back.

## Tests

API integration: full happy path; not supported; CEO rejected; withdraw;
self-decision routing to secretary / acting CEO; unresolved positions
block proposal; justification required at every step; proposal rules
(on rent, disposed, open request); direct disposal blocked without
approval, override audited; notifications and email types. Web:
propose dialog guards, decision cards show the full trail, settings
pages.

## Out of scope

- Value thresholds, inspection boards, KEW.PA forms.
- A full org chart (departments, reporting lines).
- Linking a decision to a Meeting Minutes meeting (Phase 3, later).
- Using positions for other approval flows (they are built to allow it).
