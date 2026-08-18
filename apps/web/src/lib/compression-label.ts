import type { CompressionResult } from "./compress-pdf";

const SKIP_REASONS = {
  "has-text": "left as-is — contains text",
  "no-gain": "left as-is — already compact",
  cancelled: "left as-is — compression cancelled",
} as const;

function mb(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Upload-row status text, or null when there is nothing worth saying. */
export function compressionLabel(result: CompressionResult): string | null {
  if (result.skipped === "not-pdf") return null;
  if (result.skipped) return SKIP_REASONS[result.skipped];
  return `compressed ${mb(result.originalSize)} → ${mb(result.finalSize)}`;
}
