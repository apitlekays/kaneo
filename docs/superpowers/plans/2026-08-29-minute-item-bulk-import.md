# Minute Item Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a secretariat paste a meeting's minutes in from a spreadsheet — numbered items with topic, details and status — and have the rows marked `/` become follow-up actions automatically.

**Architecture:** The client parses the CSV with the repo's existing `lib/csv.ts` and posts structured rows; the API validates them as a pure function, then writes every item and every extracted action in one transaction. `meeting_minute_item.agenda` is renamed to `topic` and gains nullable `numbering` and `status`.

**Tech Stack:** Hono + Drizzle 0.45 + Valibot (API), React 19 + TanStack Query (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-minute-item-bulk-import-design.md`

**Requirements source:** `docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`

## Global Constraints

- **This is the organisation-level Meeting Minutes module** (`meeting_*` tables). Two unrelated features are also called "minutes": `task_mom` (Project Minutes) and `letter_minute` (Letter Minutes). **`task_mom` also uses the word "agenda"** — inside a `jsonb` blob, with no `agenda` column — so the rename in this plan must never touch `apps/api/src/task-mom/`, `apps/web/src/fetchers/task-mom/`, `project-minutes.tsx` or `task-mom.tsx`.
- **UI copy always says "Meeting Minutes", never bare "Minutes".**
- **Confidentiality must hold on every path.** Bulk import must not become a weaker second door into a confidential meeting than adding one item is.
- **Errors must be distinguishable from empty and loading.**
- **Every fetcher URL must be exercised by a test** — a trailing-slash 404 shipped here before because integration tests called routes directly.
- **Both apps are at zero type errors and CI now enforces it** (`pnpm typecheck`, turbo task with `dependsOn: ["^build"]`). Any task that leaves either app failing typecheck is incomplete.
- **Biome:** spaces, double quotes, semicolons. `pnpm exec biome check --write` on touched files; never `pnpm lint` at the repo root.
- **Tests:** `pnpm --filter @kaneo/api test`, `pnpm --filter @kaneo/web test`, and integration with `DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration`. Append a filename pattern with **no `--`** before it. **Only one integration run may hit that database at a time.**
- Commit with `git commit --no-verify` (the hook runs a full build). Conventional Commits.

## What already exists and is reused

- **`apps/web/src/lib/csv.ts`** — `toCsv`, `parseCsv` (quoted fields, embedded commas/newlines, trims every value) and `downloadText`. No new dependency is needed and none may be added.
- **`apps/web/src/components/assets/asset-import-export.tsx`** — a working CSV import UI in production: file input → `parseCsv` → lowercase-keyed header lookup → mutation → toast. Follow its shape.
  - **One deliberate departure:** asset import is partial-success (`imported` / `failed`). **This import is all-or-nothing.** Do not "align" them.
- `assertMeetingWriteAccess` (proves read access first) and `assertMeetingEditable` (409 once adopted) in `apps/api/src/meeting/index.ts`.

## File Structure

**Create:**
- `apps/api/src/meeting/minute-item-import.ts` — the pure row validator and action extractor. Pure so it needs no database to test.
- `tests/api/meeting/minute-item-import.test.ts`
- `tests/api-integration/meeting-minute-import.test.ts`
- `apps/web/src/components/general-management/minute-item-import.tsx` — template download, file picker, preview, errors.
- `apps/web/src/components/general-management/minute-item-import.test.tsx`

**Modify:**
- `apps/api/src/database/schema.ts` — `meetingMinuteItemTable`
- `apps/api/src/meeting/index.ts` — the two existing minute-item routes, plus the new import route
- `apps/web/src/fetchers/meeting/index.ts` — types and the import fetcher
- `apps/web/src/components/general-management/meeting-detail-dialog.tsx` — `agenda` → `topic`, numbering/status display, mount the import UI, mark unassigned imported actions
- `tests/api-integration/meeting-crud.test.ts`, `apps/web/src/components/general-management/meeting-detail-dialog.test.tsx` — rename fallout

---

### Task 1: The pure row validator and action extractor

No schema dependency — this operates on plain strings, so it can be written and tested first.

**Files:**
- Create: `apps/api/src/meeting/minute-item-import.ts`
- Test: `tests/api/meeting/minute-item-import.test.ts`

**Interfaces:**
- Produces:
  - `type ImportRow = { numbering?: string; topic?: string; details?: string; status?: string; action?: string }`
  - `type ValidatedItem = { numbering: string | null; topic: string; details: string | null; status: string | null; isAction: boolean }`
  - `type RowError = { row: number; message: string }`
  - `validateImportRows(rows: ImportRow[]): { items: ValidatedItem[]; errors: RowError[] }`
  - `isActionMarker(value: string | undefined): boolean`
  - `IMPORT_COLUMNS: readonly ["numbering", "topic", "details", "status", "action"]`

**Row numbers are the file's, not the array's.** A spreadsheet's first data row is line 2 because line 1 is the header. `errors[].row` must be the number the user sees in Excel, so index 0 reports as row 2.

- [ ] **Step 1: Write the failing test**

Create `tests/api/meeting/minute-item-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  isActionMarker,
  validateImportRows,
} from "../../../apps/api/src/meeting/minute-item-import";

describe("IMPORT_COLUMNS", () => {
  it("is the exact contract, in order", () => {
    expect([...IMPORT_COLUMNS]).toEqual([
      "numbering",
      "topic",
      "details",
      "status",
      "action",
    ]);
  });
});

describe("isActionMarker", () => {
  it("accepts a slash with surrounding whitespace", () => {
    expect(isActionMarker("/")).toBe(true);
    expect(isActionMarker("  /  ")).toBe(true);
  });

  it("treats anything else as not-an-action rather than guessing", () => {
    // Deliberately conservative: inventing actions from "yes"/"x"/"true"
    // would create work nobody agreed to.
    for (const v of ["", "  ", "x", "X", "yes", "true", "1", "//", "\\", undefined])
      expect(isActionMarker(v)).toBe(false);
  });
});

describe("validateImportRows", () => {
  it("accepts a well-formed file and trims every field", () => {
    const { items, errors } = validateImportRows([
      { numbering: " 2.1.4 ", topic: " Budget ", details: " Discussed ", status: " Selesai ", action: "" },
    ]);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { numbering: "2.1.4", topic: "Budget", details: "Discussed", status: "Selesai", isAction: false },
    ]);
  });

  it("marks the rows carrying a slash as actions", () => {
    const { items } = validateImportRows([
      { topic: "a", action: "/" },
      { topic: "b", action: "" },
      { topic: "c", action: " / " },
    ]);
    expect(items.map((i) => i.isAction)).toEqual([true, false, true]);
  });

  it("requires a topic, reporting the spreadsheet's row number", () => {
    // Index 0 is row 2 in the file: row 1 is the header.
    const { errors } = validateImportRows([{ numbering: "1", topic: "   " }]);
    expect(errors).toEqual([{ row: 2, message: "topic is required" }]);
  });

  it("returns every problem at once, not just the first", () => {
    // A caller fixing twenty rows one round-trip at a time gives up.
    const { errors } = validateImportRows([
      { topic: "" },
      { topic: "ok" },
      { topic: "" },
    ]);
    expect(errors.map((e) => e.row)).toEqual([2, 4]);
  });

  it("rejects a numbering that repeats within the file, naming both rows", () => {
    const { errors } = validateImportRows([
      { numbering: "2.1", topic: "a" },
      { numbering: "2.1", topic: "b" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toContain("2.1");
  });

  it("allows repeated blank numbering, which cannot collide meaningfully", () => {
    const { errors, items } = validateImportRows([
      { topic: "a" },
      { topic: "b" },
    ]);
    expect(errors).toEqual([]);
    expect(items.map((i) => i.numbering)).toEqual([null, null]);
  });

  it("keeps status as free text rather than an enum", () => {
    // Malay governance terms vary by body; an enum would reject a legitimate
    // minute.
    const { errors, items } = validateImportRows([
      { topic: "a", status: "Dalam tindakan" },
      { topic: "b", status: "Makluman" },
    ]);
    expect(errors).toEqual([]);
    expect(items.map((i) => i.status)).toEqual(["Dalam tindakan", "Makluman"]);
  });

  it("nulls empty optional fields rather than storing empty strings", () => {
    const { items } = validateImportRows([{ topic: "a", details: "", status: "  " }]);
    expect(items[0].details).toBeNull();
    expect(items[0].status).toBeNull();
    expect(items[0].numbering).toBeNull();
  });

  it("rejects an empty file", () => {
    const { errors } = validateImportRows([]);
    expect(errors).toEqual([{ row: 1, message: "The file contains no rows" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/api test minute-item-import`
Expected: FAIL — cannot resolve `apps/api/src/meeting/minute-item-import`.

- [ ] **Step 3: Implement**

Create `apps/api/src/meeting/minute-item-import.ts`:

```ts
/**
 * Bulk import of minute items from the spreadsheet template.
 *
 * Pure on purpose: the route composes it with the database, and the whole of
 * the file's validity is decided here, before any write. The import is
 * all-or-nothing (a half-imported minute is worse than a rejected one — the
 * user cannot tell which rows landed, and re-running duplicates them), so
 * this must return EVERY problem at once rather than failing on the first.
 */

export const IMPORT_COLUMNS = [
  "numbering",
  "topic",
  "details",
  "status",
  "action",
] as const;

export type ImportRow = {
  numbering?: string;
  topic?: string;
  details?: string;
  status?: string;
  action?: string;
};

export type ValidatedItem = {
  numbering: string | null;
  topic: string;
  details: string | null;
  status: string | null;
  isAction: boolean;
};

export type RowError = { row: number; message: string };

/**
 * The `action` column is marked with `/` and nothing else. Any other value —
 * "x", "yes", blank — means "not an action". Guessing would invent follow-up
 * work nobody agreed to in the meeting.
 */
export function isActionMarker(value: string | undefined): boolean {
  return value?.trim() === "/";
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Row numbers are the SPREADSHEET's, not the array's: index 0 is row 2,
 * because row 1 is the header. A row number is what makes an error
 * actionable in Excel.
 */
function fileRow(index: number): number {
  return index + 2;
}

export function validateImportRows(rows: ImportRow[]): {
  items: ValidatedItem[];
  errors: RowError[];
} {
  if (rows.length === 0)
    return { items: [], errors: [{ row: 1, message: "The file contains no rows" }] };

  const errors: RowError[] = [];
  const items: ValidatedItem[] = [];
  const seenNumbering = new Map<string, number>();

  rows.forEach((raw, index) => {
    const row = fileRow(index);
    const topic = raw.topic?.trim() ?? "";
    if (!topic) errors.push({ row, message: "topic is required" });

    const numbering = clean(raw.numbering);
    if (numbering) {
      const first = seenNumbering.get(numbering);
      if (first !== undefined) {
        errors.push({
          row,
          message: `numbering "${numbering}" is already used on row ${first}`,
        });
      } else {
        seenNumbering.set(numbering, row);
      }
    }

    items.push({
      numbering,
      topic,
      details: clean(raw.details),
      status: clean(raw.status),
      isAction: isActionMarker(raw.action),
    });
  });

  return { items, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kaneo/api test minute-item-import`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/meeting/minute-item-import.ts tests/api/meeting/minute-item-import.test.ts
git commit --no-verify -m "feat(meeting): pure validator for minute-item bulk import"
```

---

### Task 2: Rename `agenda` to `topic`, add `numbering` and `status`

**This is the task with the destructive failure mode. Read the migration step before starting.**

**Files:**
- Modify: `apps/api/src/database/schema.ts`, `apps/api/src/meeting/index.ts`, `apps/web/src/fetchers/meeting/index.ts`, `apps/web/src/components/general-management/meeting-detail-dialog.tsx`, `tests/api-integration/meeting-crud.test.ts`, `apps/web/src/components/general-management/meeting-detail-dialog.test.tsx`
- Create: one drizzle migration (generated, never hand-written)

**Interfaces:**
- Produces: `meetingMinuteItemTable` with `topic` (not null), `numbering` (nullable), `status` (nullable). `MeetingMinuteItem` in the web fetcher gains `numbering: string | null` and `status: string | null`, and `agenda` becomes `topic`.

**Atomic across both apps.** `agenda` appears 44 times across 7 `meeting_*` source files. CI now enforces typecheck, so a half-rename fails the gate. Do the whole thing in this task.

**Never touch `task_mom`.** `apps/api/src/task-mom/`, `apps/web/src/fetchers/task-mom/`, `project-minutes.tsx` and `task-mom.tsx` all contain the word "agenda" and are a different feature. `git diff --stat` at the end must show none of them.

- [ ] **Step 1: Edit the schema**

In `apps/api/src/database/schema.ts`, inside `meetingMinuteItemTable`:

```ts
    position: integer("position").notNull().default(0),
    // Renamed from `agenda` (see migration): every human says "topic", and
    // this module has already spent real effort on naming precision.
    topic: text("topic").notNull(),
    // The minute's own numbering — "2.1.4", "3.2". Free text: numbering
    // schemes vary by body and are not ours to validate. Nullable because
    // items created through the single-item form have none.
    numbering: text("numbering"),
    // Free text, NOT an enum. These are Malay governance terms ("Selesai",
    // "Dalam tindakan", "Makluman"); an enum would reject a legitimate
    // minute. Nullable for the same reason as numbering.
    status: text("status"),
    discussion: text("discussion"),
```

- [ ] **Step 2: Generate the migration — the destructive trap**

`drizzle-kit generate` **prompts interactively** for a rename, and **the highlighted default is the destructive one**:

```
Is topic column in meeting_minute_item table created or renamed from another column?
❯ + topic          create column        <-- DEFAULT: drops agenda, destroys data
  ~ agenda › topic rename column
```

Piping `\n` selects nothing and writes no migration. Piping an arrow moves the cursor but Enter never commits. It must be driven through a pty. This exact script was verified against this repo on 2026-08-28 and produced the correct migration:

```bash
cd apps/api && python3 - <<'EOF'
import os, pty, time, select

out = []
def read_all(fd, timeout=0.4):
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                break
            if not d:
                break
            out.append(d.decode(errors="replace"))

pid, fd = pty.fork()
if pid == 0:
    os.execvp("pnpm", ["pnpm", "exec", "drizzle-kit", "generate"])
else:
    read_all(fd, 12)          # wait for the prompt
    os.write(fd, b"\x1b[B")   # down arrow -> "rename column"
    time.sleep(0.6)
    read_all(fd, 0.6)
    os.write(fd, b"\r")       # Enter
    time.sleep(1.5)
    read_all(fd, 8)
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
print("".join(out)[-800:])
EOF
```

- [ ] **Step 3: Read the generated SQL and STOP if it is wrong**

```bash
cat apps/api/drizzle/00*_*.sql | tail -20
grep -i "DROP COLUMN" apps/api/drizzle/00*.sql
```

The rename statement must be exactly:

```sql
ALTER TABLE "meeting_minute_item" RENAME COLUMN "agenda" TO "topic";
```

**If the file contains `DROP COLUMN "agenda"` or `ADD COLUMN "topic"` instead of `RENAME COLUMN`, delete the generated migration and its snapshot, and report — do not apply it.** That form silently destroys every existing minute item's text. Never hand-edit the migration or the snapshot under `apps/api/drizzle/meta/`; they are machine-generated and Biome excludes them for that reason.

The same migration should also add `numbering` and `status` as nullable columns. Confirm both are present and nullable.

- [ ] **Step 4: Rename every reference in the API**

In `apps/api/src/meeting/index.ts`, the two existing minute-item routes take `agenda` in their Valibot schema, trim it, and error "Agenda required". Rename the field to `topic` in both the `POST /:id/minute-items` and `PUT /:id/minute-items/:itemId` validators, change the error message to `"Topic required"`, and add `numbering` and `status` as optional strings on both, stored with `?? null`.

- [ ] **Step 5: Rename every reference in the web app**

`apps/web/src/fetchers/meeting/index.ts`:

```ts
export type MeetingMinuteItem = {
  id: string;
  meetingId: string;
  position: number;
  numbering: string | null;
  topic: string;
  details: string | null;
  status: string | null;
  discussion: string | null;
  decision: string | null;
  createdAt: string;
};

export type AddMinuteItemInput = {
  topic: string;
  numbering?: string;
  status?: string;
  discussion?: string;
  decision?: string;
  position?: number;
};
```

Note the API column is `discussion`; the CSV's `details` maps onto it. Keep one name per layer and do not introduce a second.

In `meeting-detail-dialog.tsx`, rename the `agenda` state and props to `topic` throughout (15 occurrences), change the "Add agenda item" heading to "Add minute item", and render `numbering` before the topic where present.

- [ ] **Step 6: Update the tests that referenced the old name**

`tests/api-integration/meeting-crud.test.ts` (9 occurrences) and `meeting-detail-dialog.test.tsx` (6). Rename the field; do not weaken any assertion.

- [ ] **Step 7: Verify nothing else moved, and that task_mom is untouched**

```bash
git diff --stat
grep -rn "agenda" apps/api/src apps/web/src tests | grep -v task-mom | grep -v task_mom
```
Expected: the second command prints nothing. If it prints a `meeting_*` file, the rename is incomplete.

- [ ] **Step 8: Run everything**

```bash
pnpm --filter @kaneo/api test
pnpm typecheck
DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration meeting
```
Expected: all pass, typecheck exit 0. The integration run applies the new migration to the test database — confirm it does not error.

- [ ] **Step 9: Prove the migration preserves data**

This is the assertion that matters. Against the test database, before and after applying the migration is awkward to stage, so instead assert it directly in SQL against a scratch table shape:

```bash
docker exec kaneo-sdd-pg psql -U postgres -d kaneo_test -c \
  "SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_name = 'meeting_minute_item' ORDER BY column_name;"
```
Expected: `topic` present and `NO` for nullable; `numbering` and `status` present and `YES`; **no `agenda` column**. Paste the output in your report.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit --no-verify -m "feat(meeting): rename minute item agenda to topic, add numbering and status"
```

---

### Task 3: The import endpoint

**Files:**
- Modify: `apps/api/src/meeting/index.ts`
- Test: `tests/api-integration/meeting-minute-import.test.ts` (create)

**Interfaces:**
- Consumes: `validateImportRows` from Task 1; the renamed columns from Task 2.
- Produces: `POST /meeting/:id/minute-items/import`, body `{ workspaceId, rows: ImportRow[] }`, returning `{ itemsCreated: number, actionsCreated: number }` on success, or 400 with `{ errors: RowError[] }`.

**Register it BEFORE `/:id/minute-items/:itemId`** if any ordering ambiguity exists — Hono matches in registration order, and `/import` could otherwise be captured as an `:itemId`. There is a comment in this file warning about exactly this for `/bodies`; add one here too.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/api-integration/meeting-minute-import.test.ts` covering, following the fixture conventions in `meeting-list.test.ts` (`createWorkspaceMember` seeds its own user and workspace and takes no ids; `mockAuthenticatedSession` takes the user object; `createApp()` after the session is mocked):

- A valid file creates every item in file order, with `position` continuing after any existing items.
- Exactly the `/` rows become actions, each linked to its own item via `minuteItemId`.
- An imported action has `assigneeId` null and appears in **no one's** pending decisions.
- One invalid row rejects the **whole** import and writes **nothing** — assert the item count is unchanged, not merely that the response was 400.
- Re-importing a file whose numbering already exists on the meeting is rejected, lists the conflicts, and writes nothing.
- Import into an **adopted** meeting is 409.
- A caller who cannot read a confidential meeting cannot import into it, and the meeting's title appears nowhere in the response body.
- A caller without General Management access gets 403.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @kaneo/api test:integration meeting-minute-import` with the `DATABASE_URL` above.
Expected: FAIL — route not registered, 404.

- [ ] **Step 3: Implement the route**

Add to `apps/api/src/meeting/index.ts`, before the `/:id/minute-items/:itemId` route:

```ts
// Registered BEFORE "/:id/minute-items/:itemId": Hono matches literal
// segments against parameterised ones in registration order, so a route
// declared after it would be swallowed with itemId = "import".
app.post(
  "/:id/minute-items/import",
  describeRoute({
    operationId: "importMeetingMinuteItems",
    tags: ["Meeting"],
    description:
      "Bulk-import minute items from the spreadsheet template, extracting rows marked / as actions",
  }),
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      rows: v.array(
        v.object({
          numbering: optStr,
          topic: optStr,
          details: optStr,
          status: optStr,
          action: optStr,
        }),
      ),
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const callerId = c.get("userId") as string;
    const { id } = c.req.valid("param");
    const { rows } = c.req.valid("json");

    const meeting = await loadMeeting(ws, id);
    if (!meeting) throw new HTTPException(404, { message: "Not found" });
    // Authorization before resource state, and write access proves read
    // access first — bulk import must not be a weaker door into a
    // confidential meeting than adding a single item is.
    await assertMeetingWriteAccess(callerId, ws, meeting);
    assertMeetingEditable(meeting);

    const { items, errors } = validateImportRows(rows);

    // Numbering already on this meeting is a conflict too: this is what makes
    // an accidental double-import safe rather than duplicating everything.
    const existing = await db
      .select({
        numbering: meetingMinuteItemTable.numbering,
        position: meetingMinuteItemTable.position,
      })
      .from(meetingMinuteItemTable)
      .where(eq(meetingMinuteItemTable.meetingId, id));
    const taken = new Set(
      existing.map((e) => e.numbering).filter((n): n is string => Boolean(n)),
    );
    items.forEach((item, index) => {
      if (item.numbering && taken.has(item.numbering))
        errors.push({
          row: index + 2,
          message: `numbering "${item.numbering}" already exists on this meeting`,
        });
    });

    if (errors.length > 0) return c.json({ errors }, 400);

    const startPosition =
      existing.reduce((max, e) => Math.max(max, e.position), -1) + 1;

    // All-or-nothing. A half-imported minute is worse than a rejected one:
    // the user cannot tell which rows landed, and re-running duplicates them.
    const result = await db.transaction(async (tx) => {
      let actionsCreated = 0;
      for (const [index, item] of items.entries()) {
        const [row] = await tx
          .insert(meetingMinuteItemTable)
          .values({
            meetingId: id,
            position: startPosition + index,
            numbering: item.numbering,
            topic: item.topic,
            status: item.status,
            discussion: item.details,
          })
          .returning();
        if (!row)
          throw new HTTPException(500, { message: "Failed to create minute item" });
        if (item.isAction) {
          // The action must read on its own in the Actions tab, where the
          // parent item is not on screen.
          const description = item.details
            ? `${item.topic} — ${item.details}`
            : item.topic;
          // assigneeId stays null: the CSV carries no assignee and inventing
          // one would be wrong. See the UI note in the spec — an unassigned
          // action reaches nobody until it is delegated, so the Actions tab
          // must show that.
          await tx.insert(meetingActionTable).values({
            meetingId: id,
            minuteItemId: row.id,
            description,
            fromUserId: callerId,
          });
          actionsCreated += 1;
        }
      }
      return { itemsCreated: items.length, actionsCreated };
    });

    return c.json(result, 201);
  },
);
```

Import `validateImportRows` at the top of the file alongside the other `./` imports.

- [ ] **Step 4: Run the integration tests**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration meeting-minute-import`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/meeting/index.ts tests/api-integration/meeting-minute-import.test.ts
git commit --no-verify -m "feat(meeting): bulk-import minute items and extract marked actions"
```

---

### Task 4: The web fetcher

**Files:**
- Modify: `apps/web/src/fetchers/meeting/index.ts`
- Test: `apps/web/src/fetchers/meeting/import.test.ts` (create)

**Interfaces:**
- Produces:
  - `type MinuteItemImportRow = { numbering?: string; topic?: string; details?: string; status?: string; action?: string }`
  - `type MinuteItemImportResult = { itemsCreated: number; actionsCreated: number }`
  - `importMinuteItems(workspaceId: string, id: string, rows: MinuteItemImportRow[]): Promise<MinuteItemImportResult>`

- [ ] **Step 1: Write the failing test**

Assert the requested URL is `/meeting/<id>/minute-items/import` with no trailing slash and no double slash, that the body carries `workspaceId` and `rows`, and that a 400 carrying `{ errors: [...] }` surfaces a readable message rather than a JSON wall. Follow `apps/web/src/fetchers/meeting/list.test.ts` for the fetch-stubbing shape.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web test fetchers/meeting`
Expected: FAIL — `importMinuteItems` is not exported.

- [ ] **Step 3: Implement**

```ts
export type MinuteItemImportRow = {
  numbering?: string;
  topic?: string;
  details?: string;
  status?: string;
  action?: string;
};

export type MinuteItemImportResult = {
  itemsCreated: number;
  actionsCreated: number;
};

export const importMinuteItems = (
  workspaceId: string,
  id: string,
  rows: MinuteItemImportRow[],
) =>
  post<MinuteItemImportResult>(`${id}/minute-items/import`, workspaceId, {
    rows,
  });
```

The existing `formatErrorMessage` reduces a Valibot issue tree to one line. **Extend it to also handle this route's `{ errors: [{ row, message }] }` shape**, rendering something like `Row 4: topic is required (and 2 more)`. That is the one seam every caller goes through, so fixing it there fixes it for all of them.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kaneo/web test fetchers/meeting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fetchers/meeting/
git commit --no-verify -m "feat(meeting): minute-item import fetcher"
```

---

### Task 5: The import UI

**Files:**
- Create: `apps/web/src/components/general-management/minute-item-import.tsx` and its test
- Modify: `apps/web/src/components/general-management/meeting-detail-dialog.tsx`

**Interfaces:**
- Consumes: `parseCsv`, `toCsv`, `downloadText` from `@/lib/csv`; `importMinuteItems` from Task 4.
- Produces: `<MinuteItemImport workspaceId meetingId onImported />`

Model it on `apps/web/src/components/assets/asset-import-export.tsx` — file input, `parseCsv`, lowercase-keyed header lookup, mutation, toast — **except that this import is all-or-nothing**, so there is no "N imported, M failed" outcome.

Requirements:

- A **Download template** button producing a CSV whose header row is exactly `numbering,topic,details,status,action` plus one illustrative example row, via `toCsv` and `downloadText`. Assert the exact header in a test.
- A file picker that parses on selection and **previews the parsed rows before committing**, showing which rows are marked as actions.
- On a 400, render each error **against its row number**; a spreadsheet error is only actionable with the row.
- Copy says "Meeting Minutes", never bare "Minutes".
- Hidden when the meeting is adopted, matching the existing `{!isAdopted && <AddMinuteItemForm .../>}` behaviour.
- On success, invalidate the meeting query so items and actions both refresh.

Also in `meeting-detail-dialog.tsx`: **an unassigned action must be visibly distinct and delegable in the Actions tab.** An imported action has no assignee, so it reaches nobody's pending decisions until someone delegates it — silently creating work that never surfaces is the same failure class this module has shipped before. Mark it ("Unassigned — needs delegating") and make sure the existing assign control is reachable for it. Test that an unassigned action renders that marker.

- [ ] **Step 1: Write the failing tests** covering: the template's exact header row; a parsed file previewing before import; the mutation receiving the mapped rows; row-numbered errors rendering on a 400; the component being absent when adopted; and the unassigned-action marker.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run `pnpm --filter @kaneo/web test general-management` — expect PASS.**

- [ ] **Step 5: Commit.**

---

### Task 6: Full verification

- [ ] **Step 1:** `pnpm typecheck` — exit 0. Read the exit code, not just the tail.
- [ ] **Step 2:** `pnpm --filter @kaneo/web test` and `pnpm --filter @kaneo/api test`.
- [ ] **Step 3:** `DATABASE_URL="postgresql://postgres:postgres@localhost:5470/kaneo" pnpm --filter @kaneo/api test:integration` — run alone, nothing else against that database.
- [ ] **Step 4:** `pnpm exec biome ci .` — capture the exit code explicitly; do not pipe it into `head` or `tail` and read the pipeline's status.
- [ ] **Step 5:** `pnpm build`.
- [ ] **Step 6:** confirm `git diff --stat main..HEAD` touches no `task_mom` / `task-mom` file.

## Self-Review

**Spec coverage.** CSV contract and column order → Tasks 1, 5. Downloadable template → Task 5. `/` marker semantics → Task 1. `numbering` and `status` columns → Task 2. `agenda` → `topic` rename with the drop-vs-rename trap → Task 2 (now with a proven mechanism rather than a warning). Same write authority as adding one item, and 409 when adopted → Task 3. All-or-nothing in one transaction → Task 3. Every validation error at once, with row numbers → Tasks 1, 3, 5. Numbering collision against existing items → Task 3. `position` continuing after existing items → Task 3. Auto-extracted actions linked to their item, `assigneeId` null → Task 3. The unassigned-action consequence stated in the UI → Task 5. Response summary → Tasks 3, 4.

**Placeholders:** none. Tasks 5's steps are described rather than fully coded because the component's shape follows an existing file in the repo; every required behaviour is enumerated and testable.

**Type consistency:** `ImportRow` / `ValidatedItem` / `RowError` / `validateImportRows` / `isActionMarker` / `IMPORT_COLUMNS` are defined in Task 1 and used under those names in Task 3. `MinuteItemImportRow` mirrors `ImportRow` across the network boundary; `MinuteItemImportResult` matches the route's `{ itemsCreated, actionsCreated }`. `topic` / `numbering` / `status` are introduced in Task 2 and consumed unchanged thereafter.
