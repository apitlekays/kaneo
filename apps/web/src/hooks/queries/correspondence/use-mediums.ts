import { useConfigList } from "./use-config";

/** The built-in mediums, used until a workspace has its own list. */
const DEFAULT_MEDIUMS = [
  { value: "email", label: "Email" },
  { value: "physical", label: "Physical" },
  { value: "hand", label: "By hand" },
  { value: "portal", label: "Portal" },
];

/**
 * Letter mediums from General Management → Settings → Mediums.
 *
 * `options` are the active ones a letter can be given; `labelOf` also knows
 * deactivated ones, so an older letter still shows "Fax", not "fax".
 * A workspace with no mediums configured falls back to the built-in four,
 * matching the API.
 */
export function useLetterMediums(workspaceId: string) {
  const { data: all = [], isLoading } = useConfigList(
    "mediums",
    workspaceId,
    true,
  );
  const configured = all.length > 0;
  const options = configured
    ? all
        .filter((m) => m.active !== false)
        .map((m) => ({ value: String(m.key), label: String(m.label) }))
    : DEFAULT_MEDIUMS;
  const labels = new Map<string, string>(
    configured
      ? all.map((m) => [String(m.key), String(m.label)])
      : DEFAULT_MEDIUMS.map((m) => [m.value, m.label]),
  );
  return {
    options,
    isLoading,
    labelOf: (key: string | null | undefined) =>
      key ? (labels.get(key) ?? key) : "—",
  };
}
