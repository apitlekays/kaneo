# Minutes Manager Refinements — Captured Requirements (verbatim)

**Captured:** 2026-08-27. Source: user feedback message.
**Status:** requirements captured; design questions outstanding.
**Module:** organisation-level Meeting Minutes (`meeting_*` tables). NOT
`task_mom` (Project Minutes) and NOT `letter_minute` (Letter Minutes).

> This file exists because context was nearly exhausted when the requirements
> arrived. It is the source of truth for what was asked. Read it in full
> before designing or implementing anything.

## Current state of the module (as deployed, v2.10.3)

- Tables: `meeting_type`, `meeting_body`, `meeting_body_member`, `meeting`,
  `meeting_attendee`, `meeting_minute_item`, `meeting_action`. Migration
  `0060_faithful_gressill.sql`.
- API: `apps/api/src/meeting/index.ts` (~1100 lines), mounted `/meeting`.
  Access rule `apps/api/src/meeting/access.ts` (`canReadMeeting`), decision
  rules `action-rules.ts`. Fourth pending-decision provider at
  `apps/api/src/pending-decision/providers/meeting-action.ts`.
- Web: `apps/web/src/fetchers/meeting/index.ts`,
  `apps/web/src/hooks/queries/meeting/*`,
  `components/general-management/minutes-manager.tsx` (list + create dialog),
  `meeting-detail-dialog.tsx` (~828 lines, tabbed: Overview / Attendees /
  Minute Items / Actions).
- Confidentiality: `canReadMeeting` enforced in detail route, as a filter on
  the list route, and in the provider's `list`. Write access proves read
  first (`assertMeetingWriteAccess`).
- Letter attachments already exist as a working precedent for PDF upload:
  presign → PUT → finalize, `letter_attachment` table, MinIO object storage,
  PDF-only validation. See `apps/api/src/correspondence/letters.ts` and
  `apps/web/src/components/general-management/attachment-row.tsx`.
- Letter Minutes already implement "reply with status + attachments" —
  `letter_minute_update` table, append-only, `minute-thread.tsx`. This is the
  precedent item 6 asks to copy.

---

## 1. Meetings list rendered as documents, not rows

- The page listing all minutes must render **each minute as a document** —
  a rectangular document-like card, not a list row.
- **Title inside the document rectangle**, clipped/truncated when longer than
  the rectangle.
- **Some metadata underneath** the title.
- The list must use **lazy loading**.

## 2. Omni search bar

- An **omni search bar** on the page listing all minutes.
- Searches minutes. See item 3 — it must also search PDF contents.

## 3. Upload transcripts and minute documents (PDF only), searchable

- Users can upload **transcripts of meetings** and **minute documents of
  previously held meetings**, for **archival purposes**.
- **Gate to accept PDFs only.**
- Displayed in the **Overview tab** (of the individual meeting popup).
- **Each meeting can hold/attach two or more documents.**
- The PDFs must be **searchable via the omni search bar** — not just the
  meeting title and date, but **the text inside the uploaded PDFs**.

## 4. Bulk upload of Minute Items via CSV/Excel

- In the individual minute popup, Minute Items tab: allow **bulk upload** of
  agenda items.
- Provide a **downloadable Excel/CSV template** matching the bulk upload.
- The CSV has a column the user marks as **'Action'** with a **`/`**.
  On import, the system **auto-extracts rows marked `/` into the 'Actions'
  tab as actions**.
- Include an earlier column called **'Numbering'** reflecting the minute's
  numbering system (e.g. `2.1.4`, `3.2`).
- **Exact column order required:**
  `numbering, topic, details, status, action`
- **`topic` is renamed from `agenda`.** (Current table column is `agenda`.)

## 5. 'Configure' button on each action → send-out memorandum email

- Each action gets a **'Configure'** button.
- Clicking opens a **new popup** showing details of the action, with a
  **send-out form appended at the bottom** containing:
  - name of the recipient
  - email
  - extra notes (optional)
  - reply-to email, **defaulted to `governance@mapim.org`**, and the user can
    **add more email addresses as email CC**
- Clicking **'Send'** emails the person specified.

### Exact email content required

- **Email title:**
  `Memorandum Tindakan bagi [name of the meeting] - [numbering]`

- **Email body:**
  `Dengan hormatnya, sekretariat pengurusan mesyuarat Wisma MAPIM Malaysia menjemput [name of receipient] untuk memberikan maklumbalas berkaitan cabutan minit [name of meeting] yang diadakan pada [date] yang lalu.`

- **Then render a table of 1 row** with columns: `numbering, topic, status`.

- **Email ending:**
  `Mohon jasa baik pihak tuan untuk memberikan maklumbalas terus kepada pihak sekretariat melalui emel governance@mapim.org. Segala usaha tuan kami dahului dengan ribuan terima kasih. Moga semua khidmat Ummah yang dikerjakan mendapat redhaNya dan dipermudahkan segala urusan. Terima kasih.`

- **Email signature:**
  ```
  Sekretariat Pengurusan Mesyuarat
  Wisma MAPIM Malaysia
  //Emel ini dihantar secara automatik oleh sistem MAPIMCore.
  ```
  The last line `//Emel ini dihantar secara automatik oleh sistem MAPIMCore.`
  is **styled italic grey**.

## 6. Actions get the Letter-Minutes treatment

- Each action gets the **same treatment as the Correspondence minute**:
  the user can **reply with status of the action** and **append file
  attachments**.
- Precedent to copy: `letter_minute_update` (append-only thread) +
  `letter_attachment.minuteUpdateId`, UI in `minute-thread.tsx`.

---

## Known constraints carried from this module's history

- Three unrelated features are called "minutes". New tables keep the
  `meeting_` prefix. UI copy always says "Meeting Minutes", never bare
  "Minutes".
- Confidentiality must hold on every new path. A confidential meeting's
  title has escaped through a **notification subject line** three times —
  any new email/notification path must compose `canReadMeeting`.
- Tests must assert on the field that carries the leak (e.g. `title`), not
  merely around it.
- Every fetcher URL must be exercised by a test — a trailing-slash 404
  shipped because integration tests called routes directly.
- Errors must be distinguishable from empty and loading states.
- SMTP is configured (`SMTP_*` env vars); `@kaneo/email` package exists;
  `apps/api/src/notification-preferences/delivery.ts` sends email today.

## Outstanding design questions

Asked via AskUserQuestion on 2026-08-27 — answers to be appended here.

---

## Design answers — round 1 (2026-08-27)

**Q1 — PDF full-text search.** ANSWER: **Extract text on upload with an OCR
fallback** for PDFs with no text layer (archival scans need it), **and
scale down / compress the PDF on upload to optimise storage on the VPS.**
Note: a `usePdfCompression` hook already exists in the web app (used by the
Attachments tab in Correspondence) — check whether it can be reused, and
decide client-side vs server-side compression. VPS is KVM 2: 2 vCPU, 8 GB
RAM, 96 GB disk (~9% used), so OCR cost and disk growth both matter.

**Q2 — Who may send the memorandum.** ANSWER: **any General Management page
holder**; recipient name and email are **free text** (external recipients
must work).

**Q3 — Email copy.** ANSWER: **NOT hardcoded.** The wording in section 5 is
the **default template**, which appears in a **WYSIWYG editor inside the
Configure popup**. The user can customise the text before sending.
**Provide shortcodes** the user can insert to pull data/the table from the
minute. (So: a shortcode/token system + a rich-text editor + rendering
shortcodes to email HTML.)

**Q4 — Action reply threads.** ANSWER: **copy the Letter Minutes pattern with
new tables** — a `meeting_action_update`-style append-only thread, no edit or
delete route, PDF attachments tagged to the update. No refactor of the live
Correspondence module.

## Design answers — round 2 (2026-08-27)

**Q5 — OCR/extraction runtime.** ANSWER: **async on the server after upload.**
Upload returns immediately; extraction + OCR run in the background and the
document becomes searchable shortly after. **Requires a visible "indexing"
state** in the UI so a not-yet-searchable document does not read as broken
search. Note this repo already has `trackBackgroundWork`
(`apps/api/src/utils/background-work.ts`) for making fire-and-forget work
awaitable in tests — any async indexing MUST register there, or the
integration harness will truncate underneath it and deadlock (this exact
class of bug has bitten twice).

**Q6 — PDF compression.** ANSWER: **keep the original AND a compressed copy.**
Serve the compressed version; retain the original as the archival record.
Minutes are legal records, so fidelity wins over disk. Disk grows rather than
shrinks — monitor it (VPS at ~9% of 96 GB today).

**Q7 — Rich-text editor.** ANSWER: **reuse the repo's existing editor.** The
app already ships a comment editor (~773 KB chunk, `comment-editor` in the
build output). Confirm it can emit email-safe HTML before committing to it;
if it cannot, report that rather than silently adding a second editor.

**Q8 — Send record.** ANSWER: **full record** — who sent it, to whom, when,
the CC list, AND the rendered body. Governance correspondence must be
auditable, and the record prevents duplicate memoranda.

## Design decisions still to make during spec-writing (not user questions)

- Exact shortcode vocabulary (e.g. meeting name, numbering, topic, status,
  date, recipient, and the one-row table). Must be documented in the popup.
- Whether `meeting_minute_item.agenda` is renamed to `topic` (requirement 4
  says "topic (renamed from agenda)") — a column rename is a migration on a
  live table; consider keeping the column and renaming only the UI/CSV label,
  and state the choice explicitly.
- Whether the memorandum email path composes `canReadMeeting` — it must, and
  a confidential meeting's title must not reach a recipient who cannot read
  it. This has leaked three times through notification subjects.
- Lazy loading: cursor pagination vs offset, and how it interacts with search.

---

## THE SPLIT (decided 2026-08-27) — four specs, in this order

Each is separately shippable and separately useful. Ordering is driven by
dependency, then by risk (heaviest infrastructure last).

**Spec A — Meetings library** (requirements 1, 2)
Document-card rendering with clipped titles and metadata, lazy loading, and
the omni search bar over meeting metadata (title, date, type, body).
No new infrastructure. Ships visible value immediately.
File: `2026-08-27-meetings-library-design.md`

**Spec B — Minute item bulk import** (requirement 4)
CSV/Excel template, columns `numbering, topic, details, status, action`,
rows marked `/` auto-extracted into Actions. Adds `numbering` to minute
items — which Spec C's email title depends on, so this comes first.
File: `2026-08-27-minute-item-bulk-import-design.md`

**Spec C — Action follow-through** (requirements 5, 6)
Append-only reply threads with PDF attachments on each action (copying the
Letter Minutes pattern), plus the Configure popup: WYSIWYG memorandum with
shortcodes, CC list, send, and a full send record.
Depends on B for `numbering`.
File: `2026-08-27-action-follow-through-design.md`

**Spec D — Archival documents and full-text search** (requirement 3)
PDF upload for transcripts and historical minute documents, original plus
compressed copy, async extraction with OCR fallback, Postgres full-text
search, and an "indexing" state. Extends Spec A's omni bar to search PDF
text. Heaviest infrastructure and highest risk — deliberately last.
File: `2026-08-27-archival-documents-search-design.md`

Rationale for the order: A ships value with no new infra; B unblocks C by
introducing `numbering`; C is self-contained once numbering exists; D adds
OCR and a search index and should not block the rest.
