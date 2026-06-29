// Money is stored as integer minor units (e.g. sen/cents). These helpers
// convert to/from the human decimal form and format for display.

export function formatMoney(
  minorUnits: number | null | undefined,
  currency = "MYR",
): string {
  if (minorUnits === null || minorUnits === undefined) return "—";
  const amount = minorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Parse a user-entered decimal string into integer minor units. */
export function toMinorUnits(value: string | number | null): number | null {
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Render integer minor units as an editable decimal string. */
export function fromMinorUnits(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "";
  return (minorUnits / 100).toString();
}
