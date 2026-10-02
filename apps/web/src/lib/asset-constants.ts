export type Option = { value: string; label: string };

export const ASSET_CATEGORIES: Option[] = [
  { value: "it-equipment", label: "IT Equipment" },
  { value: "media-equipment", label: "Media Equipment" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other" },
];

export const ASSET_STATUSES: Option[] = [
  { value: "active", label: "Active" },
  { value: "in-maintenance", label: "In Maintenance" },
  { value: "retired", label: "Retired" },
  { value: "disposed", label: "Disposed" },
  { value: "pending-disposal", label: "Proposed for disposal" },
  { value: "approved-for-disposal", label: "Approved for disposal" },
];

/**
 * Statuses a person can pick when editing an asset. The disposal statuses
 * are set only by the disposal approval process (the API refuses them).
 */
export const MANUAL_ASSET_STATUSES: Option[] = ASSET_STATUSES.filter(
  (s) =>
    !["disposed", "pending-disposal", "approved-for-disposal"].includes(
      s.value,
    ),
);

export const RENEWAL_TYPES: Option[] = [
  { value: "road-tax", label: "Road Tax" },
  { value: "insurance", label: "Insurance" },
  { value: "inspection", label: "Inspection" },
  { value: "licence", label: "Licence" },
  { value: "warranty", label: "Warranty" },
  { value: "software-licence", label: "Software Licence" },
  { value: "support-contract", label: "Support Contract" },
  { value: "subscription", label: "Subscription" },
  { value: "other", label: "Other" },
];

export const COST_CATEGORIES: Option[] = [
  { value: "purchase", label: "Purchase" },
  { value: "maintenance", label: "Maintenance" },
  { value: "insurance", label: "Insurance" },
  { value: "road-tax", label: "Road Tax" },
  { value: "fuel", label: "Fuel" },
  { value: "repair", label: "Repair" },
  { value: "accessory", label: "Accessory" },
  { value: "other", label: "Other" },
];

// Tailwind tones for the status badge.
export const STATUS_TONES: Record<string, string> = {
  active:
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "in-maintenance":
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  retired: "bg-muted text-muted-foreground border-border",
  disposed:
    "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
  "pending-disposal":
    "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20",
  "approved-for-disposal":
    "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export function labelOf(options: Option[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
