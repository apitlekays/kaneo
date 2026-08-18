import { useCallback, useState } from "react";

const KEY = "kaneo.correspondence.chimeMuted";

/** Sound is a per-device concern: muted at the office, audible at home. */
export function useChimePreference() {
  const [muted, setMutedState] = useState(
    () => localStorage.getItem(KEY) === "true",
  );
  const setMuted = useCallback((value: boolean) => {
    localStorage.setItem(KEY, String(value));
    setMutedState(value);
  }, []);
  return { muted, setMuted };
}
