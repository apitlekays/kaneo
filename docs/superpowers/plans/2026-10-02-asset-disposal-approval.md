# Asset disposal approval — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-01-asset-disposal-approval-design.md`
(approved 2026-10-02).

## Phase 1 — who decides

1. API, committees (`meeting/index.ts`, bodies block): member list joins
   user name/image; new `PUT /meeting/bodies/:bodyId/members/:memberId`
   (role, active), global admin only.
2. Schema: `workspace_position` (workspace, key, label, holder, acting),
   `asset_disposal_setting` (workspace, committee body).
3. API, `organisation/` module: `GET /organisation/positions`,
   `PUT /organisation/positions/:key` (global admin). Keys: `ceo`.
4. Web: General Management → **Committees** section — committee list,
   members editor, Office holders card; read-only unless global admin.

## Phase 2 — the workflow

5. Schema: `asset_disposal_request`, `asset_disposal_step`; asset statuses
   `pending-disposal`, `approved-for-disposal`.
6. API, `asset-registry/disposals.ts`: settings GET/PUT, propose,
   withdraw, list per asset, list per workspace; decider resolution with
   the no-self-decision rule.
7. Pending-decision: contract gains `labels` and `reasonRequired`;
   provider `asset-disposal` for the chair and CEO stages.
8. Gate the old direct disposal: approved request required, or global
   admin override with justification (audited). Manual status edits and
   imports can no longer set workflow statuses; rentals refuse assets
   under review.
9. Notifications `asset_disposal_review`, `asset_disposal_approval`,
   `asset_disposal_outcome` — emailed.
10. Web: asset **Disposal** tab (timeline, propose, withdraw, record);
    status badges; Asset Management **Disposals** view with settings and a
    printable proposals list; decision dialog labels + required reason.

## Phase 3 — verify

11. Integration tests per the spec; web tests for the propose guards, the
    decision card and the committees editor; typecheck, lint, build.
