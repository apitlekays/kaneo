# Action Follow-Through — Reply Threads and the Memorandum

**Date:** 2026-08-27
**Status:** Approved for planning
**Covers:** requirements 5 and 6 of
`2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`
**Spec 3 of 4.** Depends on Spec B for `meeting_minute_item.numbering`,
which the memorandum's subject line and table both render.

## Problem

An action decided in a meeting currently has an assignee and a status and
nothing else. Two things are missing: the person holding it cannot report
progress, and the secretariat cannot formally ask an outsider to act —
which is how MAPIM's minutes actually travel.

## Part 1 — Reply threads (requirement 6)

Copy the Letter Minutes pattern, which is live and proven, with new tables.
No refactor of the Correspondence module for this one's benefit.

### `meeting_action_update`

Mirrors `letter_minute_update`: `id`, `actionId` (FK cascade), `authorId`
(FK user, set null), `body` (not null), `createdAt`.

Plus, because a reply here also reports progress: **`statusAfter text`**,
nullable — the status the author is setting, or null when the update is only
a comment. Letter Minutes had no equivalent because completion was a separate
explicit step; here the ask is "reply with status of the actions", so the
status change and the note that explains it belong in one record.

**No `updatedAt`, and no update or delete route.** Immutability is enforced
by the absence of a way to do it, exactly as with `letter_minute_update`. A
correction is a new update. A later verification step must grep the API and
find only inserts and selects against this table.

### Attachments

Reuse the existing attachment machinery rather than a second store. The
letter precedent tags an attachment to a thread update via a nullable
`minuteUpdateId` on `letter_attachment`; do the same here with a
`meeting_document` row (Spec D introduces that table) or a nullable
`actionUpdateId`, whichever Spec D's shape makes coherent.

**This is the one hard ordering dependency between C and D.** If C ships
first, define the attachment link in C and let D extend it; if D ships
first, C consumes it. Whichever happens, PDF-only validation, presign and
finalize must be the *same* code path — the correspondence module already
learned that gating finalize without gating presign leaves the feature
unreachable.

### Access

Posting an update requires being the action's assignee **or** holding
General Management page access — mirroring `canPostMinuteUpdate`. Extract it
as a pure, unit-tested function; do not inline the rule in the route.

Posting an update **does not** complete the action. Completion stays the
explicit step, which already refuses an action whose `acceptance` is not
`accepted`.

## Part 2 — The memorandum (requirement 5)

A **Configure** button on each action opens a popup showing the action's
detail and, beneath it, a send-out form.

### The form

- Recipient **name** and **email** — free text, so external recipients work.
- **Extra notes**, optional.
- **Reply-to**, defaulting to `governance@mapim.org`, with the ability to add
  further addresses as **CC**.
- A **WYSIWYG editor** pre-filled with the default template below.

### The template and shortcodes

The wording in the requirements file is the **default**, not a constant. It
loads into the editor and the user may edit it before sending. Shortcodes
insert live data:

```
{{meeting_name}}   {{meeting_date}}   {{numbering}}
{{topic}}          {{status}}         {{recipient_name}}
{{action_table}}   -> the one-row table: numbering, topic, status
{{notes}}          -> the optional extra notes
```

The popup must **list the available shortcodes** where the user can see them
while editing. A token system nobody can discover is a token system nobody
uses.

Rendering is server-side. The client sends the edited template plus the
values; the server substitutes and produces the final HTML. **Never trust
the client to send finished HTML** — that would let a caller post arbitrary
markup into an outbound MAPIM email. Sanitise the editor's HTML on the
server, and substitute shortcodes after sanitising so a shortcode cannot be
smuggled in as markup.

The signature block is fixed, with the last line
`//Emel ini dihantar secara automatik oleh sistem MAPIMCore.` styled italic
grey. Exact copy lives in the requirements file — take it from there
verbatim, including the Malay.

### Sending

Reuse `sendCorrespondenceEmail` from `@kaneo/email`
(`packages/email/src/send-email.tsx:153`). It already accepts `to`, `subject`,
raw `html`, attachments and `options.replyTo`.

**It does not support CC.** Add a `cc` option to it — a small, additive
change to a shared function used by Correspondence, so its existing callers
must keep working unchanged and a test should assert that.

### Access, and the leak this must not repeat

Any General Management page holder may send. **But the send path must compose
`canReadMeeting`** before rendering anything.

A confidential meeting's title has escaped through an email or notification
**three times** in this module's short life — most recently in a subject
line, past a route-level gate that looked correct. This memorandum puts the
meeting's name in the subject *by design*, so it is the highest-risk path yet
built. The test must assert on the rendered **subject** and **body**, not
merely that a 403 was returned somewhere.

### The send record

Store every send against the action: sender, recipient name and email, the CC
list, reply-to, timestamp, and the **rendered body**. Governance
correspondence must be auditable, and the record lets the UI show that a
memorandum already went out rather than inviting a duplicate.

Surface the last send in the Configure popup.

## Testing

**Unit (pure):** the shortcode renderer — every token, an unknown token left
untouched rather than blanked, and a token appearing inside user text not
being executed twice. The update-access rule.

**API integration:**
- An assignee posts an update with a status; the action's status changes and
  the update is recorded with its author.
- A page holder who is not the assignee may post; an unrelated member may not,
  and no row is written.
- No route can edit or delete an update.
- Sending produces one send record with the rendered body.
- **A caller who cannot read a confidential meeting cannot send**, and its
  title appears in no response, subject or stored record.
- CC addresses reach the mail call; existing `sendCorrespondenceEmail`
  callers are unaffected.
- SMTP unconfigured surfaces a clear failure rather than a silent success —
  `sendCorrespondenceEmail` throws `SMTP_NOT_CONFIGURED`, and the user must
  see that, not a spinner.

**Web:** the Configure popup renders the default template and the shortcode
list; sending calls the mutation with the edited template and recipients;
a failure surfaces via toast; the last send is shown.

## Out of scope

- Inbound email replies. Recipients reply to `governance@mapim.org` by hand,
  as the template says.
- Scheduled or bulk memoranda.
- Per-workspace stored templates. The default lives in code; the user edits
  per send. Persisting templates is a later step if it is wanted.
- Any change to Letter Minutes.
