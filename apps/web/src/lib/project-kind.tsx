import type { TFunction } from "i18next";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * A consultation is a project in every respect except its name, where it is
 * listed, who may create it (global admins) and that it sits behind the
 * Consultations page grant. The screens are shared; only the words change.
 */
export type ProjectKind = "project" | "consultation";

export const CONSULTATIONS_PAGE = "consultations";

export function projectKindOf(
  project: { kind?: string | null } | null | undefined,
): ProjectKind {
  return project?.kind === "consultation" ? "consultation" : "project";
}

/**
 * `t` with the kind as i18next context: `key` becomes `key_consultation`
 * when that exists and falls back to `key` otherwise, so only the strings
 * that say "project" need a consultation variant.
 */
export function withKind(t: TFunction, kind: ProjectKind): TFunction {
  if (kind !== "consultation") return t;
  return ((key: string, options?: Record<string, unknown>) =>
    t(key, { ...options, context: "consultation" })) as TFunction;
}

const ProjectKindContext = createContext<ProjectKind>("project");

export function ProjectKindProvider({
  kind,
  children,
}: {
  kind: ProjectKind;
  children: ReactNode;
}) {
  return (
    <ProjectKindContext.Provider value={kind}>
      {children}
    </ProjectKindContext.Provider>
  );
}

export function useProjectKind(): ProjectKind {
  return useContext(ProjectKindContext);
}

/** `useTranslation`, worded for the project or consultation in scope. */
export function useKindTranslation() {
  const translation = useTranslation();
  const kind = useProjectKind();
  const t = useMemo(() => withKind(translation.t, kind), [translation.t, kind]);
  return { ...translation, t, kind };
}
