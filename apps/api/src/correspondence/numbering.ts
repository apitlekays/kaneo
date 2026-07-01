import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import type db from "../database";
import { gmNumberSequenceTable } from "../database/schema";

// Accepts either the root db or a transaction.
type DbExecutor = Pick<typeof db, "insert">;

export type NumberFormat = {
  /** Tokens: {type} {direction} {year} {serial} {dept}. e.g. "MAPIM/{type}/{year}/{serial}" */
  pattern?: string;
  /** Zero-pad width for the running serial. */
  serialPad?: number;
};

export type NumberScheme = {
  id: string;
  workspaceId: string;
  direction: string;
  letterType: string;
  format: unknown;
  resetPolicy: string;
};

function periodKeyFor(resetPolicy: string, now: Date) {
  return resetPolicy === "yearly" ? String(now.getUTCFullYear()) : "ALL";
}

const TYPE_TOKENS: Record<string, string> = {
  external: "external",
  memo: "MEMO",
  circular: "PKL",
};
const DIRECTION_TOKENS: Record<string, string> = { in: "SM", out: "SK" };

function render(
  pattern: string,
  tokens: {
    type: string;
    direction: string;
    year: string;
    serial: string;
    dept: string;
  },
) {
  return pattern.replace(/\{(type|direction|year|serial|dept)\}/g, (_m, k) => {
    return tokens[k as keyof typeof tokens] ?? "";
  });
}

function resolvePattern(format: unknown) {
  const f = (format ?? {}) as NumberFormat;
  return {
    pattern: f.pattern || "{direction}/{year}/{serial}",
    pad: typeof f.serialPad === "number" && f.serialPad > 0 ? f.serialPad : 5,
  };
}

/**
 * Allocate the next gap-free reference number for a scheme. The counter is
 * bumped atomically via an upsert, so concurrent callers never collide or skip.
 * MUST run inside the same transaction as the record it numbers.
 */
export async function allocateNumber(
  tx: DbExecutor,
  scheme: NumberScheme,
  now = new Date(),
) {
  const periodKey = periodKeyFor(scheme.resetPolicy, now);
  const [row] = await tx
    .insert(gmNumberSequenceTable)
    .values({
      id: createId(),
      workspaceId: scheme.workspaceId,
      schemeId: scheme.id,
      periodKey,
      lastValue: 1,
    })
    .onConflictDoUpdate({
      target: [gmNumberSequenceTable.schemeId, gmNumberSequenceTable.periodKey],
      set: {
        lastValue: sql`${gmNumberSequenceTable.lastValue} + 1`,
        updatedAt: now,
      },
    })
    .returning({ lastValue: gmNumberSequenceTable.lastValue });

  const serial = row?.lastValue ?? 1;
  const { pattern, pad } = resolvePattern(scheme.format);
  return render(pattern, {
    type: TYPE_TOKENS[scheme.letterType] ?? scheme.letterType,
    direction: DIRECTION_TOKENS[scheme.direction] ?? scheme.direction,
    year: periodKey,
    serial: String(serial).padStart(pad, "0"),
    dept: "",
  });
}

/** Render a sample number for the Settings preview, without allocating. */
export function previewNumber(
  scheme: Omit<NumberScheme, "id" | "workspaceId">,
) {
  const { pattern, pad } = resolvePattern(scheme.format);
  return render(pattern, {
    type: TYPE_TOKENS[scheme.letterType] ?? scheme.letterType,
    direction: DIRECTION_TOKENS[scheme.direction] ?? scheme.direction,
    year: periodKeyFor(scheme.resetPolicy, new Date()),
    serial: "1".padStart(pad, "0"),
    dept: "",
  });
}
