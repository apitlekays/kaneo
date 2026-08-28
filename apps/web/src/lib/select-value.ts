import type { Dispatch, SetStateAction } from "react";

/**
 * Base UI's `Select` types `onValueChange` as
 * `(value: string | null, details: SelectRootChangeEventDetails) => void` —
 * it can emit `null` when a selection is cleared. Passing a bare `useState`
 * setter straight in let that `null` flow into state typed as `string`,
 * silently violating the type and crashing anything downstream that calls
 * `.trim()`/`.length` on it. This wraps the setter so the `null` is mapped to
 * an explicit fallback (the value that state uses to mean "nothing
 * selected") before it reaches `setState`.
 */
export function onSelectValueChange(
  setState: Dispatch<SetStateAction<string>>,
  fallback = "",
) {
  return (value: string | null) => setState(value ?? fallback);
}
