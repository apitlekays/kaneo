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
    return {
      items: [],
      errors: [{ row: 1, message: "The file contains no rows" }],
    };

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
