# Register Fields and Year Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add External Reference Number, Urgency and owning Organisation to correspondence, group the register by year with a sortable date column, and carry urgency to every surface that shows a letter.

**Architecture:** Three columns on `letter` plus a `gm_organisation` config table that rides the existing `registerConfigResource` helper and the declarative settings screen. The register's grouping, sorting and reference resolution live in pure functions so they can be tested without rendering. Urgency reaches the accept/reject dialog through a new optional `badges` field on the generic `PendingDecisionItem` contract, keeping that dialog free of correspondence knowledge.

**Tech Stack:** Hono + Drizzle + Valibot (API); React 19 + TanStack Query + Tailwind v4 (web); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-19-correspondence-register-fields-and-grouping-design.md`

**Scope note:** this plan covers the fields and the register display only. Letter linking — the picker, the thread dialog, and bidirectional links — is a separate plan.

## Global Constraints

- Organisation values, exactly: `mapim-malaysia` / MAPIM Malaysia, `ummahprima` / UmmahPrima Sdn Bhd, `stagemaster` / StageMaster Sdn Bhd, `ladangummah` / LadangUmmah Sdn Bhd.
- Urgency values, exactly: `urgent` and `normal`. Column is `NOT NULL DEFAULT 'normal'`.
- The backfill updates **only** rows where `organisation_id IS NULL`. Never overwrite a value someone set.
- Year headings group on `receivedAt ?? letterDate ?? createdAt` — the same date the Date column shows and sorts by. Never the registration date.
- Grouping never turns off. Sorting flips both the order of year headings and the order within them.
- Incoming letters show ERN, falling back to `refNo`, then `—`; the header reads **ERN**. Outgoing shows `refNo`; the header reads **Ref No.**
- Urgent renders a badge. Normal renders nothing at all.
- All API inputs validated with Valibot; all routes carry `describeRoute`.
- Biome: double quotes, semicolons, spaces for TS/TSX. Conventional Commits.

---

## File Structure

**API**
- `apps/api/src/database/schema.ts` — 3 columns on `letterTable`, new `gmOrganisationTable`
- `apps/api/drizzle/0054_register_fields.sql` — columns, table, seed, backfill
- `apps/api/src/correspondence/index.ts` — register the `organisations` config resource
- `apps/api/src/correspondence/letters.ts` — accept the 3 fields on create/update
- `apps/api/src/pending-decision/types.ts` — optional `badges` on `PendingDecisionItem`
- `apps/api/src/pending-decision/providers/correspondence.ts` — populate `badges`

**Web**
- `apps/web/src/lib/letter-reference.ts` — direction-aware reference resolution (new)
- `apps/web/src/lib/letter-grouping.ts` — year grouping + sort toggle (new)
- `apps/web/src/lib/urgency.ts` — urgency → badge props (new)
- `apps/web/src/components/general-management/settings.tsx` — descriptor + tab
- `apps/web/src/components/general-management/letter-capture-dialog.tsx` — 3 fields
- `apps/web/src/components/general-management/correspondence.tsx` — grouping, sorting, columns
- `apps/web/src/components/general-management/letter-detail-dialog.tsx` — urgency badge
- `apps/web/src/components/home/my-correspondence.tsx` — urgency badge
- `apps/web/src/components/pending-decision-dialog.tsx` — render `badges`
- `apps/web/src/lib/notification-copy.ts` — urgent prefix

---

### Task 1: Schema, migration, seed and backfill

**Files:**
- Modify: `apps/api/src/database/schema.ts` (letterTable ~2093-2170; new table beside `gmCategoryTable` ~1804)
- Create: `apps/api/drizzle/0054_register_fields.sql`
- Modify: `apps/api/drizzle/meta/_journal.json` and a new `apps/api/drizzle/meta/0054_snapshot.json`

**Interfaces:**
- Produces: `letterTable.externalRefNo`, `letterTable.urgency`, `letterTable.organisationId`; `gmOrganisationTable` with `{ id, workspaceId, key, label, active, createdAt }`

- [ ] **Step 1: Add the columns to `letterTable`**

In `apps/api/src/database/schema.ts`, inside the `letter` table definition, add beside `refNo`:

```ts
    // Sender's own reference. Primary lookup key for incoming letters.
    externalRefNo: text("external_ref_no"),
    // urgent | normal
    urgency: text("urgency").notNull().default("normal"),
    organisationId: text("organisation_id").references(
      () => gmOrganisationTable.id,
      { onDelete: "set null" },
    ),
```

And add an index to that table's index array:

```ts
    index("letter_ws_ern_idx").on(table.workspaceId, table.externalRefNo),
```

- [ ] **Step 2: Add the `gm_organisation` table**

Immediately after `gmCategoryTable` (`schema.ts:1822`), matching its shape exactly:

```ts
export const gmOrganisationTable = pgTable(
  "gm_organisation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("gm_organisation_workspaceId_idx").on(table.workspaceId),
    unique("gm_organisation_ws_key_unique").on(table.workspaceId, table.key),
  ],
);
```

Note: `gmOrganisationTable` must be declared BEFORE `letterTable` references it, or move the reference to a callback — the existing file already uses `() => table` callbacks, so declaration order is not a problem, but check the file compiles.

- [ ] **Step 3: Add it to the schema barrel**

`apps/api/src/database/index.ts` exports every table in a `schema` object. Add `gmOrganisationTable` in the same alphabetical position the file uses. There is a test at `tests/api/database/schema-barrel.test.ts` that fails if a table is missing — run it.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @kaneo/api db:generate`

This writes a new `apps/api/drizzle/00NN_*.sql`, a `meta/00NN_snapshot.json`, and appends to `meta/_journal.json`. Do NOT hand-write the snapshot or the journal entry — drizzle chains snapshots by id, and a hand-copied snapshot forks the chain.

Rename the generated `.sql` to `0054_register_fields.sql` ONLY if drizzle numbered it 0054; if drizzle chose a different number, keep drizzle's name and use that number everywhere below.

- [ ] **Step 5: Append the seed and backfill to the generated SQL**

Add to the bottom of the generated migration file:

```sql
--> statement-breakpoint
-- Seed the group's four entities into every existing workspace. New
-- workspaces start empty, like every other gm_* config table.
INSERT INTO "gm_organisation" ("id", "workspace_id", "key", "label")
SELECT
  md5(w."id" || o."key")::text,
  w."id",
  o."key",
  o."label"
FROM "workspace" w
CROSS JOIN (VALUES
  ('mapim-malaysia', 'MAPIM Malaysia'),
  ('ummahprima', 'UmmahPrima Sdn Bhd'),
  ('stagemaster', 'StageMaster Sdn Bhd'),
  ('ladangummah', 'LadangUmmah Sdn Bhd')
) AS o("key", "label")
ON CONFLICT ("workspace_id", "key") DO NOTHING;
--> statement-breakpoint
-- Every letter already in the register predates the other three companies,
-- so MAPIM Malaysia is the accurate owner rather than an invented one.
-- Deliberately scoped to NULLs so a re-run cannot overwrite a hand-set value.
-- Recorded here rather than as per-letter audit events: this is a bulk
-- classification applied by migration, not an action any user took.
UPDATE "letter" l
SET "organisation_id" = o."id"
FROM "gm_organisation" o
WHERE o."workspace_id" = l."workspace_id"
  AND o."key" = 'mapim-malaysia'
  AND l."organisation_id" IS NULL;
```

Note on the seed id: `gm_organisation.id` is normally a CUID2 generated in application code, but SQL cannot call `createId()`. `md5(workspace_id || key)` gives a deterministic, unique text id, which the column accepts (it is `text`, not a constrained format). Rows created later through the settings screen get real CUID2s. If you prefer, `gen_random_uuid()::text` also works — pick one and say which in your report.

- [ ] **Step 6: Verify the migration applies to a real database**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

Wait for `docker exec kaneo-test-pg pg_isready -U postgres`, then run the integration suite, which applies migrations on startup:

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts
```

Expected: all suites pass (86 tests at the time of writing). This proves the migration applies cleanly and breaks nothing.

Tear down when done: `docker rm -f kaneo-test-pg`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database apps/api/drizzle
git commit --no-verify -m "feat(api): add ERN, urgency and owning organisation to letters"
```

---

### Task 2: The organisations config resource and the API fields

**Files:**
- Modify: `apps/api/src/correspondence/index.ts` (beside the `gm_category` registration ~206)
- Modify: `apps/api/src/correspondence/letters.ts` (the letter create and update validators)
- Test: `tests/api/correspondence/register-fields.test.ts`

**Interfaces:**
- Consumes: `gmOrganisationTable` from Task 1
- Produces: `GET/POST/PATCH/DELETE /correspondence/organisations`; letter create and update accept `externalRefNo`, `urgency`, `organisationId`

- [ ] **Step 1: Write the failing test**

Create `tests/api/correspondence/register-fields.test.ts`. This tests the Valibot schema in isolation — no database:

```ts
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { letterUrgencySchema } from "../../../apps/api/src/correspondence/register-fields";

describe("letterUrgencySchema", () => {
  it("accepts the two urgency levels", () => {
    expect(v.parse(letterUrgencySchema, "urgent")).toBe("urgent");
    expect(v.parse(letterUrgencySchema, "normal")).toBe("normal");
  });

  it("rejects anything else", () => {
    expect(() => v.parse(letterUrgencySchema, "critical")).toThrow();
    expect(() => v.parse(letterUrgencySchema, "")).toThrow();
    expect(() => v.parse(letterUrgencySchema, "URGENT")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/register-fields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the shared schema**

Create `apps/api/src/correspondence/register-fields.ts`:

```ts
import * as v from "valibot";

/** The register records two urgency levels and no others. */
export const letterUrgencySchema = v.picklist(["urgent", "normal"]);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/correspondence/register-fields.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the test bites**

Change the picklist to `v.string()`, re-run, and confirm the rejection test FAILS. Restore.

- [ ] **Step 6: Register the organisations config resource**

In `apps/api/src/correspondence/index.ts`, directly after the `gm_category` block (`~line 206-260`), add a matching block. Read that block first and mirror it exactly, substituting:

- `path: "organisations"`
- `entityType: "gm_organisation"`
- `gmOrganisationTable` in place of `gmCategoryTable`
- the same `createSchema` / `updateSchema` shape (`workspaceId`, `key`, `label`, `active`)

Import `gmOrganisationTable` alongside the other table imports at the top of the file.

- [ ] **Step 7: Accept the three fields on letter create and update**

In `apps/api/src/correspondence/letters.ts`, find the Valibot object for letter creation (the capture route's `validator("json", …)`) and the update route's schema. Add to both:

```ts
      externalRefNo: optStr,
      urgency: v.optional(letterUrgencySchema),
      organisationId: optStr,
```

`optStr` is already defined in that file and used by the neighbouring optional string fields — reuse it rather than writing a new optional wrapper. Import `letterUrgencySchema` from `./register-fields`.

Ensure the create handler passes the three values through to the insert, and the update handler to the update — follow exactly how the adjacent fields (e.g. `fileRef`) are threaded.

**Do not write any audit code.** The spec requires that changing these fields is attributable, and that already happens: the capture route records `after: row` (`letters.ts:810-818`) and the update route records `before` and `after: row` (`letters.ts:~893`) — whole rows, so new columns are captured the moment they exist. Adding per-field audit calls would double-record. Confirm this by reading both call sites and say in your report that you did.

- [ ] **Step 8: Run the API suite**

Run: `pnpm --filter @kaneo/api test`
Expected: PASS. Report the total.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/correspondence tests/api/correspondence
git commit --no-verify -m "feat(api): organisations config resource and register field inputs"
```

---

### Task 3: The register's pure display logic

**Files:**
- Create: `apps/web/src/lib/letter-reference.ts`
- Create: `apps/web/src/lib/letter-grouping.ts`
- Create: `apps/web/src/lib/urgency.ts`
- Test: `apps/web/src/lib/letter-reference.test.ts`
- Test: `apps/web/src/lib/letter-grouping.test.ts`
- Test: `apps/web/src/lib/urgency.test.ts`

**Interfaces:**
- Produces:
  - `letterReference(letter: { direction: string; refNo: string | null; externalRefNo: string | null }): string`
  - `referenceHeader(direction: "in" | "out"): string`
  - `letterYearDate(letter: { receivedAt: string | null; letterDate: string | null; createdAt: string }): Date`
  - `groupLettersByYear<T>(letters: T[], dateOf: (l: T) => Date, direction: "asc" | "desc"): { year: number; letters: T[] }[]`
  - `nextSortDirection(current: "asc" | "desc"): "asc" | "desc"`
  - `urgencyBadge(urgency: string): { label: string; variant: string } | null`

- [ ] **Step 1: Write the failing tests for reference resolution**

Create `apps/web/src/lib/letter-reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { letterReference, referenceHeader } from "./letter-reference";

describe("letterReference", () => {
  it("prefers the external reference on an incoming letter", () => {
    expect(
      letterReference({
        direction: "in",
        refNo: "MAPIM/2026/0114",
        externalRefNo: "JAKIM/5/2026",
      }),
    ).toBe("JAKIM/5/2026");
  });

  it("falls back to the internal reference when an incoming letter has no ERN", () => {
    expect(
      letterReference({
        direction: "in",
        refNo: "MAPIM/2026/0114",
        externalRefNo: null,
      }),
    ).toBe("MAPIM/2026/0114");
  });

  it("shows a dash when an incoming letter has neither", () => {
    expect(
      letterReference({ direction: "in", refNo: null, externalRefNo: null }),
    ).toBe("—");
  });

  it("always uses the internal reference on an outgoing letter", () => {
    expect(
      letterReference({
        direction: "out",
        refNo: "MAPIM/2026/0114",
        externalRefNo: "SHOULD/NOT/APPEAR",
      }),
    ).toBe("MAPIM/2026/0114");
  });

  it("shows a dash for an outgoing letter with no reference yet", () => {
    expect(
      letterReference({ direction: "out", refNo: null, externalRefNo: "X/1" }),
    ).toBe("—");
  });
});

describe("referenceHeader", () => {
  it("names the column for what it holds", () => {
    expect(referenceHeader("in")).toBe("ERN");
    expect(referenceHeader("out")).toBe("Ref No.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/lib/letter-reference.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `apps/web/src/lib/letter-reference.ts`:

```ts
/**
 * Incoming letters are quoted by the sender's own reference, so that wins.
 * Outgoing letters are ours and carry only our number — showing an ERN there
 * would attribute someone else's reference to a letter we sent.
 */
export function letterReference(letter: {
  direction: string;
  refNo: string | null;
  externalRefNo: string | null;
}): string {
  if (letter.direction === "in")
    return letter.externalRefNo ?? letter.refNo ?? "—";
  return letter.refNo ?? "—";
}

export function referenceHeader(direction: "in" | "out"): string {
  return direction === "in" ? "ERN" : "Ref No.";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kaneo/web exec vitest run src/lib/letter-reference.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing tests for grouping**

Create `apps/web/src/lib/letter-grouping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  groupLettersByYear,
  letterYearDate,
  nextSortDirection,
} from "./letter-grouping";

type Row = {
  id: string;
  receivedAt: string | null;
  letterDate: string | null;
  createdAt: string;
};

const row = (
  id: string,
  receivedAt: string | null,
  letterDate: string | null = null,
  createdAt = "2026-06-01T00:00:00.000Z",
): Row => ({ id, receivedAt, letterDate, createdAt });

describe("letterYearDate", () => {
  it("prefers the received date", () => {
    expect(
      letterYearDate(row("a", "2025-03-04T00:00:00.000Z", "2024-01-01T00:00:00.000Z")).getUTCFullYear(),
    ).toBe(2025);
  });

  it("falls back to the letter's own date", () => {
    expect(
      letterYearDate(row("a", null, "2024-01-01T00:00:00.000Z")).getUTCFullYear(),
    ).toBe(2024);
  });

  it("falls back to the created date last", () => {
    expect(letterYearDate(row("a", null, null)).getUTCFullYear()).toBe(2026);
  });
});

describe("groupLettersByYear", () => {
  const rows = [
    row("a", "2025-03-04T00:00:00.000Z"),
    row("b", "2026-01-09T00:00:00.000Z"),
    row("c", "2025-11-20T00:00:00.000Z"),
  ];

  it("groups newest year first and newest letter first by default", () => {
    const groups = groupLettersByYear(rows, letterYearDate, "desc");
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
    expect(groups[1].letters.map((l) => l.id)).toEqual(["c", "a"]);
  });

  it("flips both the group order and the order within a group", () => {
    const groups = groupLettersByYear(rows, letterYearDate, "asc");
    expect(groups.map((g) => g.year)).toEqual([2025, 2026]);
    expect(groups[0].letters.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupLettersByYear([], letterYearDate, "desc")).toEqual([]);
  });

  it("puts a backdated letter in its own year, not the year it was entered", () => {
    // The office registers historical correspondence; grouping on the entry
    // date would pile decades of letters under one heading.
    const backdated = [row("old", "2019-08-01T00:00:00.000Z", null, "2026-08-19T00:00:00.000Z")];
    expect(groupLettersByYear(backdated, letterYearDate, "desc")[0].year).toBe(2019);
  });
});

describe("nextSortDirection", () => {
  it("toggles", () => {
    expect(nextSortDirection("desc")).toBe("asc");
    expect(nextSortDirection("asc")).toBe("desc");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/lib/letter-grouping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement grouping**

Create `apps/web/src/lib/letter-grouping.ts`:

```ts
/**
 * The date the register groups and sorts by. Deliberately the letter's own
 * date rather than when it was entered: the office registers historical
 * correspondence, and grouping by entry date would file decades of letters
 * under the year someone typed them in.
 */
export function letterYearDate(letter: {
  receivedAt: string | null;
  letterDate: string | null;
  createdAt: string;
}): Date {
  return new Date(letter.receivedAt ?? letter.letterDate ?? letter.createdAt);
}

export function nextSortDirection(current: "asc" | "desc"): "asc" | "desc" {
  return current === "desc" ? "asc" : "desc";
}

/** Grouping never turns off; sorting flips the groups and their contents together. */
export function groupLettersByYear<T>(
  letters: T[],
  dateOf: (letter: T) => Date,
  direction: "asc" | "desc",
): { year: number; letters: T[] }[] {
  const buckets = new Map<number, T[]>();
  for (const letter of letters) {
    const year = dateOf(letter).getUTCFullYear();
    const bucket = buckets.get(year);
    if (bucket) bucket.push(letter);
    else buckets.set(year, [letter]);
  }

  const sign = direction === "desc" ? -1 : 1;
  return [...buckets.entries()]
    .sort(([a], [b]) => (a - b) * sign)
    .map(([year, group]) => ({
      year,
      letters: [...group].sort(
        (a, b) => (dateOf(a).getTime() - dateOf(b).getTime()) * sign,
      ),
    }));
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @kaneo/web exec vitest run src/lib/letter-grouping.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Prove the grouping tests bite**

Delete the `* sign` from the group sort (leaving `(a - b)`), re-run, and confirm the "flips both" test FAILS. Restore. Then delete `* sign` from the within-group sort and confirm the same test FAILS on the letter order. Restore.

- [ ] **Step 10: Write the failing tests for urgency**

Create `apps/web/src/lib/urgency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { urgencyBadge } from "./urgency";

describe("urgencyBadge", () => {
  it("renders nothing for a normal letter", () => {
    // A badge on every row would stop the urgent ones standing out.
    expect(urgencyBadge("normal")).toBeNull();
  });

  it("renders a badge for an urgent letter", () => {
    expect(urgencyBadge("urgent")).toEqual({
      label: "Urgent",
      variant: "destructive",
    });
  });

  it("treats an unknown value as normal rather than guessing", () => {
    expect(urgencyBadge("")).toBeNull();
    expect(urgencyBadge("critical")).toBeNull();
  });
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/lib/urgency.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 12: Implement it**

Create `apps/web/src/lib/urgency.ts`:

```ts
/**
 * Normal returns null on purpose: a grey "Normal" badge on every row is
 * visual noise that makes the urgent ones harder to spot, not easier.
 */
export function urgencyBadge(
  urgency: string,
): { label: string; variant: string } | null {
  return urgency === "urgent"
    ? { label: "Urgent", variant: "destructive" }
    : null;
}
```

- [ ] **Step 13: Run the whole web suite**

Run: `pnpm --filter @kaneo/web test`
Expected: PASS. Report the total.

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/lib/letter-reference.ts apps/web/src/lib/letter-reference.test.ts apps/web/src/lib/letter-grouping.ts apps/web/src/lib/letter-grouping.test.ts apps/web/src/lib/urgency.ts apps/web/src/lib/urgency.test.ts
git commit --no-verify -m "feat(web): register reference, grouping and urgency helpers"
```

---

### Task 4: Settings screen and registration form

**Files:**
- Modify: `apps/web/src/components/general-management/settings.tsx` (descriptor map ~40-60, `TABS` ~349)
- Modify: `apps/web/src/components/general-management/letter-capture-dialog.tsx`
- Modify: `apps/web/src/fetchers/correspondence/letters.ts` (the `Letter` type)

**Interfaces:**
- Consumes: `GET /correspondence/organisations` from Task 2
- Produces: `Letter` type carrying `externalRefNo: string | null`, `urgency: string`, `organisationId: string | null`

- [ ] **Step 1: Add the organisations descriptor and tab**

In `settings.tsx`, add to the descriptor map beside `"categories"`:

```tsx
    organisations: {
      title: "Organisation",
      description: "Group entities a letter can belong to.",
      fields: [
        { key: "key", label: "Key", type: "text", required: true },
        { key: "label", label: "Label", type: "text", required: true },
      ],
      columns: [
        { key: "label", label: "Label" },
        { key: "key", label: "Key" },
      ],
    },
```

And add to `TABS`, after `{ value: "categories", label: "Categories" }`:

```tsx
  { value: "organisations", label: "Organisations" },
```

Read the neighbouring entries first — if the descriptor map's entries carry fields this one omits, match the real shape rather than this listing.

- [ ] **Step 2: Extend the `Letter` type**

In `apps/web/src/fetchers/correspondence/letters.ts`, add to the `Letter` type beside `refNo`:

```ts
  externalRefNo: string | null;
  urgency: string;
  organisationId: string | null;
```

- [ ] **Step 3: Add the three fields to the capture dialog**

In `letter-capture-dialog.tsx`:

Add the organisations list beside the existing config lists (~line 53):

```tsx
  const { data: organisations = [] } = useConfigList(
    "organisations",
    workspaceId,
  );
```

Add state beside the existing field state (~line 71):

```tsx
  const [externalRefNo, setExternalRefNo] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [organisationId, setOrganisationId] = useState("");
```

Reset all three in the reset handler (~line 88), matching how the neighbouring fields reset.

Add them to the submit payload (~line 108):

```tsx
        externalRefNo: externalRefNo.trim() || undefined,
        urgency,
        organisationId: organisationId || undefined,
```

Render three controls following the exact `<Label>` + control pattern already in the file. The Urgency select offers `Normal` (value `normal`) and `Urgent` (value `urgent`). The Organisation select lists `organisations` by `label` with `id` as the value.

- [ ] **Step 4: Make Organisation required before submit**

Disable the submit button when `!organisationId`, matching however the dialog already gates submission on required fields. If it does not currently gate on anything, add the check to the submit handler and surface it the way the file already surfaces validation.

- [ ] **Step 5: Verify by hand**

There is no test harness for this dialog in the repo. Run `pnpm --filter @kaneo/web build` to typecheck the TSX, then state plainly in your report whether you were able to run the app and see the fields, or whether this step was type-checking only.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/general-management/settings.tsx apps/web/src/components/general-management/letter-capture-dialog.tsx apps/web/src/fetchers/correspondence/letters.ts
git commit --no-verify -m "feat(web): capture ERN, urgency and organisation at registration"
```

---

### Task 5: The register list

**Files:**
- Modify: `apps/web/src/components/general-management/correspondence.tsx` (both tables: the pending tile ~178-215 and the register ~224-300)
- Test: `apps/web/src/components/general-management/correspondence.test.tsx`

**Interfaces:**
- Consumes: `letterReference`, `referenceHeader`, `groupLettersByYear`, `letterYearDate`, `nextSortDirection`, `urgencyBadge` from Task 3

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/components/general-management/correspondence.test.tsx`. Mock the data hooks the component uses — read the component's imports first and mock exactly those. The test must assert behaviour, not implementation:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock the query hooks this component uses. Read the component's imports and
// mock those exact module paths — the list below is the shape, not the answer.

afterEach(cleanup);

describe("correspondence register", () => {
  it("groups letters under year headings, newest year first", async () => {
    // Two letters in 2025, one in 2026.
    // Assert the headings render in the order 2026, 2025.
  });

  it("flips both heading order and row order when Date is clicked", async () => {
    // Click the Date header. Assert headings become 2025, 2026 and that the
    // rows inside 2025 reverse.
  });

  it("shows the ERN for an incoming letter and labels the column ERN", async () => {
    // Assert the header text and the cell value.
  });

  it("shows an Urgent badge only on the urgent letter", async () => {
    // Assert exactly one badge for two letters, one urgent one normal.
  });
});
```

Fill in each block with a real arrangement and real assertions. A test body left as comments is a task failure.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/components/general-management/correspondence.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add sort state and grouping to the register table**

In `correspondence.tsx`, add near the component's other state:

```tsx
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
```

Replace the register table's flat `.map` over letters with grouped rendering:

```tsx
  const groups = groupLettersByYear(letters, letterYearDate, sortDirection);
```

Render each group as a full-width heading row followed by its letters. The heading row spans every column — count the columns after adding the new ones and set `colSpan` to match.

- [ ] **Step 4: Make the Date header sortable**

```tsx
                <TableHead>
                  <button
                    type="button"
                    onClick={() => setSortDirection(nextSortDirection(sortDirection))}
                    className="inline-flex items-center gap-1"
                  >
                    Date
                    {sortDirection === "desc" ? "↓" : "↑"}
                  </button>
                </TableHead>
```

- [ ] **Step 5: Make the reference column direction-aware**

Replace `<TableHead>Ref No.</TableHead>` in the register table with `<TableHead>{referenceHeader(direction)}</TableHead>`, and the cell's `{letter.refNo ?? "—"}` with `{letterReference(letter)}`.

Do the same in the pending-registration tile at the top of the file — it renders `item.refNo ?? "—"` under its own `Ref No.` header. Two tables on one screen must not disagree about what a letter is called.

- [ ] **Step 6: Add the urgency and organisation columns**

Add two headers and two cells. Urgency renders a badge only when `urgencyBadge(letter.urgency)` is non-null:

```tsx
                  <TableCell>
                    {(() => {
                      const badge = urgencyBadge(letter.urgency);
                      return badge ? (
                        <Badge variant={badge.variant} className="text-xs">
                          {badge.label}
                        </Badge>
                      ) : null;
                    })()}
                  </TableCell>
```

Organisation renders the organisation's label. The list rows carry `organisationId`, not the label, so fetch the organisations with `useConfigList("organisations", workspaceId)` and resolve through a `Map`. Show `—` when unset.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @kaneo/web test`
Expected: PASS, including your four new tests.

- [ ] **Step 8: Prove the tests bite**

Change `sortDirection` to a constant `"desc"` so the header click does nothing; confirm the flip test FAILS. Restore. Then make the urgency cell always render a badge; confirm the badge test FAILS. Restore.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/general-management/correspondence.tsx apps/web/src/components/general-management/correspondence.test.tsx
git commit --no-verify -m "feat(web): group the register by year with a sortable date column"
```

---

### Task 6: Urgency on the detail view and the Home feed

**Files:**
- Modify: `apps/web/src/components/general-management/letter-detail-dialog.tsx`
- Modify: `apps/web/src/components/home/my-correspondence.tsx`
- Test: `apps/web/src/components/home/my-correspondence.test.tsx` (exists — extend it)

**Interfaces:**
- Consumes: `urgencyBadge` from Task 3

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/home/my-correspondence.test.tsx` already exists with mocked data at line ~30. Read it, then add:

```tsx
  it("marks an urgent letter and leaves a normal one unmarked", () => {
    // Set the mocked data to two letters, one urgency "urgent" and one
    // "normal". Render. Assert exactly one "Urgent" badge appears.
  });
```

Fill in the body with the real arrangement, following how the existing tests in that file set `data.current`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kaneo/web exec vitest run src/components/home/my-correspondence.test.tsx`
Expected: FAIL — no badge rendered.

- [ ] **Step 3: Render the badge in the Home feed**

In `my-correspondence.tsx`, render the badge beside each letter's subject when `urgencyBadge(letter.urgency)` is non-null, matching the file's existing `Badge` usage.

- [ ] **Step 4: Render the badge in the detail dialog**

In `letter-detail-dialog.tsx`, render the badge next to the letter's status. Find where status is displayed and place it adjacent, following the existing badge markup.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @kaneo/web test` — expect PASS.

```bash
git add apps/web/src/components/home apps/web/src/components/general-management/letter-detail-dialog.tsx
git commit --no-verify -m "feat(web): show urgency on the letter detail and Home feed"
```

---

### Task 7: Urgency in the accept/reject dialog and notifications

**Files:**
- Modify: `apps/api/src/pending-decision/types.ts`
- Modify: `apps/api/src/pending-decision/providers/correspondence.ts`
- Modify: `apps/web/src/fetchers/pending-decision/index.ts` (the `PendingDecisionItem` type)
- Modify: `apps/web/src/components/pending-decision-dialog.tsx`
- Modify: `apps/web/src/lib/notification-copy.ts`
- Test: `tests/api/pending-decision/correspondence-provider.test.ts` (exists — extend)
- Test: `apps/web/src/lib/notification-copy.test.ts` (exists — extend)

**Interfaces:**
- Produces: `PendingDecisionItem.badges?: { label: string; tone: "urgent" | "info" }[]`

- [ ] **Step 1: Extend the contract**

In `apps/api/src/pending-decision/types.ts`, add to `PendingDecisionItem`:

```ts
  /**
   * Optional emphasis a provider wants shown on the card. Keeps the dialog
   * free of any one module's vocabulary — correspondence sends urgency here
   * rather than the dialog learning what a letter is.
   */
  badges?: { label: string; tone: "urgent" | "info" }[];
```

Mirror the same optional field in the web type at `apps/web/src/fetchers/pending-decision/index.ts`.

- [ ] **Step 2: Write the failing provider test**

Add to `tests/api/pending-decision/correspondence-provider.test.ts`:

```ts
  it("flags an urgent letter with a badge and leaves a normal one bare", () => {
    // Call the item mapper with urgency "urgent" and assert
    // badges equals [{ label: "Urgent", tone: "urgent" }].
    // Call it with "normal" and assert badges is undefined or empty.
  });
```

The provider's `list` runs a database query, so extract the row-to-item mapping into an exported pure function first — `toPendingItem(row)` — and test that. Fill in the body with real assertions.

- [ ] **Step 3: Run to verify it fails, then implement**

Run the file. Expect FAIL. Then in `providers/correspondence.ts`, extract the mapper and populate `badges` only when `row.urgency === "urgent"`. Add `urgency` to the `select` — it is not currently selected.

- [ ] **Step 4: Render badges in the dialog**

In `pending-decision-dialog.tsx`, render `item.badges` above the context lines, mapping `tone: "urgent"` to the destructive badge variant and `"info"` to the default. Render nothing when the array is absent or empty.

- [ ] **Step 5: Write the failing notification-copy test**

Add to `apps/web/src/lib/notification-copy.test.ts`:

```ts
  it("prefixes an urgent letter assignment", () => {
    // A letter_assigned notification whose eventData carries urgency
    // "urgent" produces a title beginning "Urgent: ".
  });

  it("leaves a normal assignment unprefixed", () => {
    // The same notification with urgency "normal" has no prefix.
  });
```

Fill in with real arrangements matching how the existing tests in that file build a notification.

- [ ] **Step 6: Implement the prefix**

In `notification-copy.ts`, prefix the `letter_assigned` title with `Urgent: ` when the event data says urgency is urgent. The API must send it: find where `letter_assigned` notifications are published in `apps/api/src/correspondence/letters.ts` and add `urgency` to the event data.

- [ ] **Step 7: Prove the tests bite**

Remove the `badges` population and confirm the provider test FAILS. Restore. Remove the prefix and confirm the copy test FAILS. Restore.

- [ ] **Step 8: Run everything**

```bash
pnpm --filter @kaneo/api test
pnpm --filter @kaneo/web test
pnpm --filter @kaneo/web build
```

Report all totals.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/pending-decision apps/web/src/fetchers/pending-decision apps/web/src/components/pending-decision-dialog.tsx apps/web/src/lib/notification-copy.ts apps/api/src/correspondence/letters.ts tests/api/pending-decision apps/web/src/lib/notification-copy.test.ts
git commit --no-verify -m "feat: carry letter urgency into the decision dialog and notifications"
```

---

### Task 8: Full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Start PostgreSQL**

```bash
docker run -d --name kaneo-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=kaneo_test -p 5432:5432 postgres:16-alpine
```

Wait for `docker exec kaneo-test-pg pg_isready -U postgres`.

- [ ] **Step 2: Run the integration suite**

```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts
```

Expected: PASS. This re-applies the migration from Task 1 on a clean database, which is the only proof the seed and backfill SQL are valid.

- [ ] **Step 3: Verify the seed and backfill actually did something**

Against the same database, confirm four organisations exist per workspace and that no letter was left with a null organisation:

```bash
docker exec kaneo-test-pg psql -U postgres -d kaneo_test -c "SELECT key, count(*) FROM gm_organisation GROUP BY key ORDER BY key;"
docker exec kaneo-test-pg psql -U postgres -d kaneo_test -c "SELECT count(*) AS letters_without_org FROM letter WHERE organisation_id IS NULL;"
```

The integration suite resets the database between tests, so these may legitimately show zero rows. If so, say that plainly in your report rather than claiming verification you did not achieve — and instead apply the migration to a fresh database with a seeded workspace and letter, and check there.

- [ ] **Step 4: Run everything else**

```bash
pnpm test
pnpm --filter @kaneo/web build
```

- [ ] **Step 5: Tear down**

```bash
docker rm -f kaneo-test-pg
```

Do this even if a step above failed.

- [ ] **Step 6: Report**

State every total. If anything failed, report BLOCKED with the exact output rather than a summary.

---

## Browser verification (before this branch is called done)

1. Open GM settings → Organisations. The four entities are listed.
2. Register an incoming letter with an ERN, Urgent, and an organisation. It appears in the register under the correct year heading, showing the ERN under an "ERN" header, an Urgent badge, and the organisation.
3. Register an outgoing letter. Its tab's header reads "Ref No." and shows the internal reference.
4. Click the Date header. Year headings and rows both reverse.
5. Register a letter dated in a previous year. It files under that year, not the current one.
6. Route an urgent letter to another user. Their toast reads "Urgent: …", and the accept/reject dialog shows the Urgent badge.
