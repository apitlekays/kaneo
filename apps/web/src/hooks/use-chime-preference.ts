import { useCallback, useSyncExternalStore } from "react";

const KEY = "kaneo.correspondence.chimeMuted";

// The toggle and the component that plays the chime are mounted in different
// parts of the tree, so the preference cannot live in per-component state.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return localStorage.getItem(KEY) === "true";
}

/** Sound is a per-device concern: muted at the office, audible at home. */
export function useChimePreference() {
  const muted = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const setMuted = useCallback((value: boolean) => {
    localStorage.setItem(KEY, String(value));
    for (const listener of listeners) listener();
  }, []);
  return { muted, setMuted };
}
