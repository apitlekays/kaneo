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
