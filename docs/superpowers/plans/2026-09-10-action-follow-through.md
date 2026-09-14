# Action Follow-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the person holding a meeting action report progress with attachments, and let the secretariat formally ask an outsider to act via a memorandum email.

**Architecture:** Two independently shippable phases. Phase 1 adds an append-only reply thread per action plus PDF attachments, copying the live Letter Minutes pattern. Phase 2 adds the Configure popup: a Markdown template edited in the repo's existing TipTap editor, rendered to email HTML server-side with shortcodes substituted as escaped values, sent through `sendCorrespondenceEmail` with a full send record.

**Tech Stack:** Hono + Drizzle + Valibot (API), React 19 + TanStack Query + TipTap (web), `@react-email/render`, MinIO, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-action-follow-through-design.md`

**Requirements source (exact Malay copy lives here):** `docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`

## Two phases, two deploys

**Phase 1 (Tasks 1–6) is shippable on its own** and delivers the whole of requirement 6. **Phase 2 (Tasks 7–12)** delivers requirement 5. Deploy after Phase 1 if you want the thread in users' hands sooner; nothing in Phase 2 is blocked by waiting, and nothing in Phase 1 depends on Phase 2.

## Global Constraints

- **This is the organisation-level Meeting Minutes module** (`meeting_*`). `task_mom` (Project Minutes) and `letter_minute` (Letter Minutes) are unrelated features that share the word "minutes" — never touch them. New tables take the `meeting_` prefix.
- **UI copy always says "Meeting Minutes", never bare "Minutes".**
- **Confidentiality must hold on every path.** A confidential meeting's title has escaped this module **three times in production**, most recently in a notification subject line. The memorandum puts the meeting's name in the subject *by design*, making Phase 2 the highest-risk path yet built here. Tests must assert on the rendered **subject and body**, not merely that a 403 came back.
- **Both apps are at zero type errors and CI enforces it** (`pnpm typecheck`, turbo task with `dependsOn: ["^build"]`). Any task leaving either app failing typecheck is incomplete.
- **`noUncheckedIndexedAccess` and `strict` are on.** No `any`, no `@ts-ignore`, no non-null `!`.
- **Tests:** `pnpm --filter @kaneo/api test`, `pnpm --filter @kaneo/web test`, and integration with `DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration`. Append a filename pattern with **no `--`** before it. **Only one integration run may hit that database at a time.**
- **Known pre-existing flake:** `letter-capture-links.test.tsx` fails intermittently under full-suite load. Byte-identical to `main`, green run alone. Not yours.
- Biome: spaces, double quotes, semicolons. `pnpm exec biome check --write` on touched files; never `pnpm lint` at the repo root.
- Commit with `git commit --no-verify`. Conventional Commits.

## What the investigation established — read before designing anything

These were verified in the codebase on 2026-09-10. Do not re-derive them, and do not contradict them without saying why.

1. **The repo's editor speaks Markdown, not HTML.** `apps/web/src/components/activity/comment-editor.tsx` (default export `CommentEditor`) is a TipTap editor whose `onUpdate` calls `normalizeMarkdown(editor.getMarkdown())`. Its `value`/`onChange` carry **Markdown**. `taskId`, `uploadSurface`, `ensureTaskId` and `showQuickAttachButton` are all optional, and `markdown-renderer.tsx` already reuses it read-only outside the comment context — so it is genuinely reusable here.

   **This is better than the spec assumed.** The spec worried about sanitising arbitrary client HTML; a Markdown payload is a far smaller surface. See Task 9 for the ordering that keeps it safe.

2. **There is no server-side Markdown renderer and no HTML sanitiser** in `apps/api` or `packages/email`. `packages/email` builds HTML with `@react-email/components` + `@react-email/render`, which is where inline, email-client-safe styling comes from.

3. **`sendCorrespondenceEmail` has no `cc`.** Signature today: `(to, subject, html, attachments?, options?: { replyTo?, fromName? })` in `packages/email/src/send-email.tsx`. It throws `SMTP_NOT_CONFIGURED` when `SMTP_HOST` or `SMTP_FROM` is unset.

4. **`letter_minute_update` is the thread precedent**: `id`, `minuteId` (FK cascade), `authorId` (FK user, set null), `body` (not null), `createdAt`, plus an index on the parent. No `updatedAt` and no update/delete route — immutability is enforced by the absence of a way to do it.

5. **`canPostMinuteUpdate`** (`apps/api/src/correspondence/minute-access.ts`) is the access precedent: `hasPageAccess` grants, otherwise the assignee only. Pure, unit-tested, not inlined in the route.

6. **`assertCanAttach`** (`apps/api/src/correspondence/letters.ts:205`) is **one gate shared by presign and finalize**. The module learned this the hard way: gating finalize alone leaves the feature unreachable because the caller cannot obtain an upload URL.

7. **`letter_attachment` is the storage shape to mirror**: `objectKey` (not null, unique), `filename`, `mimeType`, `size` (integer), `sha256`, `kind` (default "original"), `createdBy`, `createdAt`, plus a **nullable `minuteUpdateId`** that tags an attachment to a thread update.

8. **An imported action is created `acceptance: "accepted"`** with a null assignee (shipped in 3.0.0), and this module's convention is that an unassigned action is accepted. The complete route requires `acceptance === "accepted"`.

## File Structure

**Phase 1 — create:**
- `apps/api/src/meeting/update-access.ts` — the pure post-an-update rule
- `tests/api/meeting/update-access.test.ts`
- `apps/api/src/meeting/action-updates.ts` — the thread routes and the attachment presign/finalize pair
- `tests/api-integration/meeting-action-updates.test.ts`
- `apps/web/src/components/general-management/action-thread.tsx` + its test

**Phase 1 — modify:** `apps/api/src/database/schema.ts`, `apps/api/src/meeting/index.ts` (mount the routes), `apps/web/src/fetchers/meeting/index.ts`, `apps/web/src/hooks/queries/meeting/use-meeting-mutations.ts`, `meeting-detail-dialog.tsx`

**Phase 2 — create:**
- `apps/api/src/meeting/memorandum.ts` — the shortcode renderer and the memo HTML builder
- `tests/api/meeting/memorandum.test.ts`
- `tests/api-integration/meeting-memorandum.test.ts`
- `apps/web/src/components/general-management/action-configure-dialog.tsx` + its test

**Phase 2 — modify:** `packages/email/src/send-email.tsx` (add `cc`), `apps/api/src/database/schema.ts` (the send record), `apps/api/src/meeting/index.ts`, the web fetcher and the detail dialog

---

# Phase 1 — reply threads and attachments

### Task 1: Schema — `meeting_action_update` and `meeting_document`

**Files:** Modify `apps/api/src/database/schema.ts`; generate one migration.

**Interfaces produced:** `meetingActionUpdateTable`, `meetingDocumentTable`.

**Why this task creates `meeting_document`.** The spec deferred the attachment link to "whichever shape Spec D makes coherent", and Spec D decided: a `meeting_document` row with a **nullable `actionUpdateId`** and a **not-null `meetingId`**. Since C ships first, C creates the table with exactly those columns and D extends it later with its storage and indexing fields. `meetingId` is not null on both kinds — a reply attachment and a meeting-level document alike — because that is what lets **one** confidentiality check cover every attachment path instead of two rules that can drift.

- [ ] **Step 1: Add both tables**

```ts
// Append-only progress thread on a meeting action. Mirrors
// `letter_minute_update`, with one addition: `statusAfter`.
//
// Letter Minutes had no equivalent because completion there was a separate
// explicit step. Here the ask is "reply with status of the actions", so the
// status change and the note explaining it belong in one record.
//
// NO `updatedAt`, and deliberately NO update or delete route — immutability
// is enforced by the absence of a way to do it, exactly as with
// `letter_minute_update`. A correction is a new update.
export const meetingActionUpdateTable = pgTable(
  "meeting_action_update",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    actionId: text("action_id")
      .notNull()
      .references(() => meetingActionTable.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    // The status the author is setting, or null when the update is only a
    // comment. Free text is wrong here — this drives the action's own
    // `status` column, which is the open | done | cancelled enum.
    statusAfter: text("status_after"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("meeting_action_update_actionId_idx").on(table.actionId),
  ],
);

// A PDF attached either to a meeting (archival, Spec D) or to one action
// thread update (`actionUpdateId` set). `meetingId` is NOT NULL on both
// kinds: it is what makes a single confidentiality check cover every
// attachment path rather than two rules that can drift apart.
//
// Spec D extends this table with its storage and indexing fields
// (`originalObjectKey`, `indexStatus`, `extractedText`, …). Do not add
// those here.
export const meetingDocumentTable = pgTable(
  "meeting_document",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetingTable.id, { onDelete: "cascade" }),
    // Null for a meeting-level document; set for a reply attachment.
    actionUpdateId: text("action_update_id"),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256"),
    kind: text("kind").notNull().default("original"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("meeting_document_meetingId_idx").on(table.meetingId),
    index("meeting_document_actionUpdateId_idx").on(table.actionUpdateId),
  ],
);
```

Note `actionUpdateId` has **no FK constraint**, mirroring `letter_attachment.minuteUpdateId`. Follow the precedent rather than adding one.

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api && pnpm exec drizzle-kit generate
```

This adds two new tables, so drizzle should **not** prompt — the interactive rename prompt only appears when it suspects a rename. If it does prompt, something is wrong: stop and report rather than guessing at the answer.

- [ ] **Step 3: Read the generated SQL**

It must be `CREATE TABLE` for both plus their indexes, and must contain **no `ALTER`, no `DROP`, and no `RENAME`** against any existing table. Paste it in your report. This migration is purely additive, which keeps image rollback safe — unlike `0061`. Say so in your report.

- [ ] **Step 4: Apply and verify**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration meeting-crud
```
The suite migrates on boot. Then confirm the shape:
```bash
docker exec kaneo-sdd-pg psql -U postgres -d kaneo_test -c \
  "SELECT table_name, column_name, is_nullable FROM information_schema.columns
   WHERE table_name IN ('meeting_action_update','meeting_document') ORDER BY 1,2;"
```
Expected: `meeting_document.meeting_id` and `workspace_id` are `NO`; `action_update_id` is `YES`. Paste the output.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit --no-verify -m "feat(meeting): action update thread and document tables"
```

---

### Task 2: The pure access rule

**Files:** Create `apps/api/src/meeting/update-access.ts` and `tests/api/meeting/update-access.test.ts`.

**Interfaces produced:** `canPostActionUpdate(args: { userId: string; hasPageAccess: boolean; actionAssigneeId: string | null }): boolean`

Mirror `canPostMinuteUpdate` exactly in shape and reasoning: a General Management page holder may post; otherwise only the action's assignee. Keep it pure and unit-tested — do not inline the rule in the route.

- [ ] **Step 1: Write the failing test** covering: a page holder who is not the assignee may post; the assignee may post; an unrelated member may not; a **null** `actionAssigneeId` never matches a caller (the imported-action case — an unassigned action must not become postable by anyone who happens to have a null id in some code path).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @kaneo/api test update-access`

- [ ] **Step 3: Implement**

```ts
/**
 * Who may post a progress update on a meeting action.
 *
 * Mirrors `canPostMinuteUpdate` (correspondence/minute-access.ts): holding
 * the General Management page is enough, because the secretariat chases
 * actions it does not own; otherwise only the assignee may speak for their
 * own work.
 *
 * Deliberately pure — the route composes it with the real lookups, so the
 * rule can be tested without a database and cannot drift between callers.
 */
export function canPostActionUpdate(args: {
  userId: string;
  hasPageAccess: boolean;
  actionAssigneeId: string | null;
}): boolean {
  if (args.hasPageAccess) return true;
  return (
    args.actionAssigneeId !== null && args.actionAssigneeId === args.userId
  );
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(meeting): pure access rule for action updates`

---

### Task 3: The thread route

**Files:** Create `apps/api/src/meeting/action-updates.ts`; modify `apps/api/src/meeting/index.ts` to mount it. Test: `tests/api-integration/meeting-action-updates.test.ts`.

**Interfaces produced:**
- `POST /meeting/:id/actions/:actionId/updates` — body `{ workspaceId, body, statusAfter? }` → 201 with the created row
- `GET /meeting/:id/actions/:actionId/updates` — the thread, oldest first
- The action's `status` changes when `statusAfter` is set.

**Route ordering.** Register these **before** any `/:id/actions/:actionId` catch-all if one exists. There is no `POST /:id/actions/:actionId` today, so the trap is latent rather than live — order correctly anyway, and add the same warning comment the `/bodies` and `/minute-items/import` blocks carry.

**Behaviour that must hold:**

- Compose `assertMeetingWriteAccess`? **No** — that would be wrong. Posting an update is not editing the meeting. Compose `assertCanReadMeeting` (a confidential meeting stays closed to non-attendees) and then `canPostActionUpdate` with `hasWorkspacePageAccess` and the action's `assigneeId`.
- **Posting an update does not complete the action.** Completion stays the explicit step, which already refuses an action whose `acceptance` is not `accepted`. If `statusAfter` is `"done"`, set the action's `status` — but do **not** set `completedAt`/`completedBy`, and do not bypass the acceptance precondition. If that reads as a contradiction, it is the spec's intent: the thread records what the holder says; the complete route records the formal act.
- `statusAfter`, when present, must be one of `open | done | cancelled` — validate with `v.picklist`, not free text. This drives the action's own enum column.
- The update and any status change happen in **one transaction**.
- Adopted meetings do **not** block this: actions stay mutable on an adopted meeting (there is a comment in `meeting/index.ts` saying so). Do not call `assertMeetingEditable`.

**Integration tests must cover:**
- The assignee posts with `statusAfter: "done"`; the update is recorded with its author and the action's `status` becomes `done`.
- A page holder who is not the assignee may post; an unrelated workspace member may not, **and no row is written**.
- A comment-only update (`statusAfter` omitted) leaves the action's status untouched.
- **No route can edit or delete an update** — assert by grepping the mounted app's routes, or by attempting `PUT`/`PATCH`/`DELETE` on the update path and asserting 404. Say which you did.
- A caller who cannot read a **confidential** meeting gets 403 and the meeting's title appears **nowhere** in the response body.
- Posting on an **adopted** meeting's action succeeds (the deliberate asymmetry above).
- An invalid `statusAfter` is rejected.

- [ ] **Step 1: Write the failing integration tests** following `tests/api-integration/meeting-list.test.ts`'s fixture conventions — `createWorkspaceMember` seeds its own user and workspace and takes **no ids**; `mockAuthenticatedSession` takes the user **object**; `createApp()` after the session is mocked; an owner is a global admin, so a non-admin needs a separate member seeded into the owner's workspace plus `grantGeneralManagement`.
- [ ] **Step 2: Run to verify they fail** (404, route unmounted).
- [ ] **Step 3: Implement the routes.**
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Run the whole `meeting` integration set** to catch ordering regressions from the new mount.
- [ ] **Step 6: Commit.**

---

### Task 4: Attachments on an update

**Files:** Modify `apps/api/src/meeting/action-updates.ts`. Tests in the same integration file.

**Interfaces produced:**
- `POST /meeting/:id/attachments/presign` — body `{ workspaceId, filename, mimeType, size, actionUpdateId? }` → an upload URL and the `objectKey`
- `POST /meeting/:id/attachments/finalize` — records the `meeting_document` row
- `GET /meeting/:id/attachments/:docId/download` — a presigned download

**One gate, shared.** Write `assertCanAttachMeetingDocument(userId, workspaceId, meeting, actionUpdateId)` and call it from **presign and finalize both**. `apps/api/src/correspondence/letters.ts:205` is the precedent and the reason: gating finalize alone left that feature unreachable, because the caller could not obtain an upload URL. With `actionUpdateId` set, the update must belong to an action on **this** meeting (404 otherwise) and only that action's assignee or a GM page holder may attach.

**PDF only**, enforced in the shared gate — so it holds on presign as well as finalize. Client-side validation is a convenience, never the boundary.

Reuse the existing MinIO helpers in `apps/api/src/storage/` rather than adding a second client; read that module and follow it.

**Tests:** a non-PDF is refused at **presign as well as finalize**; an attachment on an update belonging to a different meeting is 404; a non-attendee cannot attach to a confidential meeting's action; the assignee can; the finalized row carries a not-null `meetingId` even when `actionUpdateId` is set.

- [ ] Steps 1–5 as above: failing tests, watch them fail, implement, pass, commit.

---

### Task 5: Web data layer

**Files:** Modify `apps/web/src/fetchers/meeting/index.ts` and `use-meeting-mutations.ts`. Test: a new fetcher URL-contract test.

**Interfaces produced:** `MeetingActionUpdate` type; `listActionUpdates`, `postActionUpdate`, and the attachment presign/finalize/download fetchers; a `postActionUpdate` mutation invalidating `["meeting", workspaceId, meetingId]`.

**Assert the requested URLs in a test.** A trailing-slash 404 shipped in this module because integration tests called routes directly and nothing exercised the client's URL construction. Follow `apps/web/src/fetchers/meeting/list.test.ts`.

- [ ] Steps as above.

---

### Task 6: The thread UI

**Files:** Create `apps/web/src/components/general-management/action-thread.tsx` + test; modify `meeting-detail-dialog.tsx` to mount it per action.

`apps/web/src/components/general-management/minute-thread.tsx` is the Letter Minutes UI to model on — read it first and follow its shape.

Requirements:
- The thread renders oldest-first, each entry showing author, timestamp, body, and the status it set (when it set one).
- A composer that posts body plus an optional status.
- **No edit and no delete affordance** — the thread is append-only, and the UI must not imply otherwise.
- Attachments listed per update, with a PDF-only picker. Reuse `apps/web/src/lib/is-pdf-upload.ts`.
- Loading, error and empty states all distinguishable — this module shipped a bug where a failed query rendered as "no data".
- Copy says "Meeting Minutes", never bare "Minutes".

- [ ] Steps as above. **Phase 1 ends here and is deployable.**

---

# Phase 2 — the memorandum

### Task 7: `cc` on `sendCorrespondenceEmail`

**Files:** Modify `packages/email/src/send-email.tsx`. Test: a new unit test in that package, or extend an existing one — check what is there.

Add `cc?: string | string[]` to the existing `options` object and pass it to `transporter.sendMail`. **Additive only.** This function is used by Correspondence today; a test must assert its existing callers behave unchanged — same `from` composition, same `replyTo`, same `SMTP_NOT_CONFIGURED` throw when `SMTP_HOST` or `SMTP_FROM` is unset.

- [ ] Steps as above.

---

### Task 8: The shortcode renderer

**Files:** Create `apps/api/src/meeting/memorandum.ts` and `tests/api/meeting/memorandum.test.ts`.

**Interfaces produced:**
- `MEMO_SHORTCODES` — the documented vocabulary
- `renderShortcodes(html: string, values: Record<string, string>): string`
- `escapeHtml(value: string): string`

The vocabulary, which the popup must also display to the user:

```
{{meeting_name}}   {{meeting_date}}   {{numbering}}
{{topic}}          {{status}}         {{recipient_name}}
{{action_table}}   -> the one-row table: numbering, topic, status
{{notes}}          -> the optional extra notes
```

**Behaviour the tests must pin:**
- Every token substitutes.
- An **unknown** token is left untouched, not blanked — a typo should be visible in the draft, not silently swallowed.
- A token appearing **inside a substituted value** is not substituted again. Do a single pass; a naive repeated `replace` lets a meeting titled `{{notes}}` inject the notes.
- Values are **HTML-escaped** on substitution. A meeting titled `<script>` must appear as text.
- `{{action_table}}` renders the one-row table with its three columns.
- A token with surrounding whitespace inside the braces — `{{ topic }}` — is a genuine question: decide whether to accept it, and pin your decision in a test either way.

- [ ] Steps as above.

---

### Task 9: The memo HTML

**Files:** Modify `apps/api/src/meeting/memorandum.ts`. Tests in the same unit file.

**Interfaces produced:** `buildMemorandumHtml(args): { subject: string; html: string }`

**The exact copy is in the REQUIREMENTS file — take it from there verbatim, including the Malay.** Do not retype it from memory and do not "improve" the wording. The subject is `Memorandum Tindakan bagi [meeting name] - [numbering]`. The signature block's last line, `//Emel ini dihantar secara automatik oleh sistem MAPIMCore.`, is **italic grey**.

**The rendering pipeline, and the order matters:**

1. The client sends the **Markdown** its editor produced (see investigation note 1 — `CommentEditor` round-trips Markdown, not HTML).
2. The server renders that Markdown to HTML with **raw HTML disabled**, so any `<script>` the author typed becomes escaped text rather than markup. Add `markdown-it` to `apps/api` and configure it `{ html: false, linkify: false, typographer: false }`. **Do not hand-roll a Markdown parser** — that is how injection bugs are written.
3. **Then** substitute shortcodes, with values HTML-escaped (Task 8).

That order is what the spec meant by "substitute shortcodes after sanitising so a shortcode cannot be smuggled in as markup". Doing it the other way round — substituting into the Markdown source — would let a meeting's own title inject Markdown syntax.

4. Wrap the result in the memo shell built with `@react-email/components` and rendered by `@react-email/render`, which is how `packages/email` already produces inline-styled, email-client-safe HTML. The fixed greeting, table and signature live in the shell; only the editable body comes from step 3.

**Never trust the client to send finished HTML.** The route accepts Markdown and values; it does not accept HTML.

- [ ] Steps as above, with tests asserting: the exact subject format; the Malay copy present verbatim; the signature's last line carries italic grey styling; a `<script>` in the author's Markdown is escaped in the output; a `<script>` in a substituted value is escaped.

---

### Task 10: The send route and the send record

**Files:** Modify `apps/api/src/database/schema.ts` (a `meeting_action_memo` table), `apps/api/src/meeting/index.ts`. Test: `tests/api-integration/meeting-memorandum.test.ts`.

**The send record** stores, against the action: sender, recipient name and email, the CC list, reply-to, timestamp, and the **rendered body**. Governance correspondence must be auditable, and the record is what lets the UI show a memorandum already went out rather than inviting a duplicate. One migration, additive.

**Access, and the leak this must not repeat.** Any General Management page holder may send — **but the send path must compose `assertCanReadMeeting` first.** A confidential meeting's title has escaped this module three times, most recently in a subject line, and this memorandum puts the meeting's name in the subject *by design*. The test must assert on the rendered **subject** and **body**, not merely that a 403 was returned somewhere.

**Reply-to defaults to `governance@mapim.org`**; recipient name and email are free text so external recipients work; CC is a list.

**Tests:** a send produces exactly one record with the rendered body; a caller who cannot read a confidential meeting cannot send, **and its title appears in no response, subject or stored record**; CC addresses reach the mail call; existing `sendCorrespondenceEmail` callers are unaffected; **SMTP unconfigured surfaces a clear failure rather than a silent success** — it throws `SMTP_NOT_CONFIGURED` and the user must see that, not a spinner.

- [ ] Steps as above.

---

### Task 11: The Configure popup

**Files:** Create `apps/web/src/components/general-management/action-configure-dialog.tsx` + test; modify `meeting-detail-dialog.tsx` to add the Configure button per action.

Requirements:
- The popup shows the action's detail, then the send-out form beneath it.
- Fields: recipient **name** and **email** (free text), optional **extra notes**, **reply-to** defaulting to `governance@mapim.org`, and **CC** accepting further addresses.
- A **`CommentEditor`** pre-filled with the default template, which the user may edit before sending. Pass `value`/`onChange` (Markdown) and leave the task-specific props unset. Do not add a second editor.
- **The available shortcodes must be listed where the user can see them while editing.** A token system nobody can discover is a token system nobody uses.
- The last send, if any, is surfaced so a duplicate is not invited.
- A failure surfaces via toast; an SMTP misconfiguration must read as a failure, not a silent success.

- [ ] Steps as above.

---

### Task 12: Full verification

- [ ] `pnpm typecheck` — exit 0, and read the **exit code**, not a piped tail.
- [ ] `pnpm --filter @kaneo/api test` and `pnpm --filter @kaneo/web test`.
- [ ] Integration **alone**: `DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration`.
- [ ] `pnpm exec biome ci .` — capture the exit code explicitly.
- [ ] `pnpm build`.
- [ ] Confirm `git diff --stat main..HEAD` touches no `task_mom` / `task-mom` / `letter_minute` file.
- [ ] Confirm the migrations added are **purely additive** (`CREATE TABLE` only) so image rollback stays safe — unlike `0061`.

## Self-Review

**Spec coverage.** Reply threads with `statusAfter` → Task 3. Append-only with no update/delete route → Tasks 1, 3. Attachments reusing the existing machinery behind one shared gate → Task 4. The access rule as a pure function → Task 2. Posting not completing the action → Task 3. The Configure popup with the send form → Task 11. The default template in a WYSIWYG with discoverable shortcodes → Tasks 8, 11. Server-side rendering that never trusts client HTML → Task 9. The exact Malay copy and italic-grey signature line → Task 9. `cc` added additively → Task 7. Confidentiality composed on the send path, asserted on subject and body → Task 10. The full send record surfaced in the popup → Tasks 10, 11.

**Deviations from the spec, both deliberate and stated where they occur:** the spec assumed the editor emits HTML needing sanitisation; it emits Markdown, so Task 9 renders Markdown with raw HTML disabled instead, which is a smaller surface. And the spec left the attachment table's ownership open between C and D; C creates it, per Spec D's decided shape.

**Placeholders:** none. Tasks 6 and 11 describe behaviour rather than carrying full component code because both follow an existing file in the repo (`minute-thread.tsx`, and the Letter Minutes send form); every required behaviour is enumerated and testable.

**Type consistency:** `canPostActionUpdate` is defined in Task 2 and used in Tasks 3 and 4. `meetingActionUpdateTable` / `meetingDocumentTable` are defined in Task 1 and consumed unchanged thereafter. `MEMO_SHORTCODES` / `renderShortcodes` / `escapeHtml` are defined in Task 8 and used in Task 9; `buildMemorandumHtml` in Task 9 and used in Task 10. `MeetingActionUpdate` is defined in Task 5 and consumed in Task 6.
