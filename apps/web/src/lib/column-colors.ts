/**
 * Column color palette. The stored value on a column is the option `key`
 * (e.g. "green"); a null/empty value falls back to a sensible default based on
 * the column slug so existing projects get tinted without a migration.
 *
 * Tailwind classes are written as full literal strings so the JIT scanner
 * includes them in the build — do not construct them dynamically.
 */
export type ColumnColorOption = {
  key: string;
  label: string;
  /** Solid swatch used in the palette picker and the column header dot. */
  dot: string;
  /** Subtle background tint applied to the column body. */
  tint: string;
};

export const COLUMN_COLOR_OPTIONS: ColumnColorOption[] = [
  { key: "gray", label: "Gray", dot: "bg-slate-400", tint: "bg-slate-500/5" },
  { key: "blue", label: "Blue", dot: "bg-blue-500", tint: "bg-blue-500/5" },
  { key: "cyan", label: "Cyan", dot: "bg-cyan-500", tint: "bg-cyan-500/5" },
  {
    key: "green",
    label: "Green",
    dot: "bg-emerald-500",
    tint: "bg-emerald-500/5",
  },
  { key: "amber", label: "Amber", dot: "bg-amber-500", tint: "bg-amber-500/5" },
  {
    key: "orange",
    label: "Orange",
    dot: "bg-orange-500",
    tint: "bg-orange-500/5",
  },
  { key: "rose", label: "Rose", dot: "bg-rose-500", tint: "bg-rose-500/5" },
  {
    key: "violet",
    label: "Violet",
    dot: "bg-violet-500",
    tint: "bg-violet-500/5",
  },
];

/** Default color for the columns every project ships with. */
export const DEFAULT_COLUMN_COLOR_BY_SLUG: Record<string, string> = {
  "to-do": "gray",
  "in-progress": "blue",
  "in-review": "amber",
  done: "green",
};

const FALLBACK_COLOR_KEY = "gray";

export function resolveColumnColorKey(
  slug: string,
  color?: string | null,
): string {
  if (color && COLUMN_COLOR_OPTIONS.some((option) => option.key === color)) {
    return color;
  }
  return DEFAULT_COLUMN_COLOR_BY_SLUG[slug] ?? FALLBACK_COLOR_KEY;
}

function getColumnColorOption(slug: string, color?: string | null) {
  const key = resolveColumnColorKey(slug, color);
  return (
    COLUMN_COLOR_OPTIONS.find((option) => option.key === key) ??
    COLUMN_COLOR_OPTIONS[0]
  );
}

export function getColumnTintClass(slug: string, color?: string | null) {
  return getColumnColorOption(slug, color).tint;
}

export function getColumnDotClass(slug: string, color?: string | null) {
  return getColumnColorOption(slug, color).dot;
}
