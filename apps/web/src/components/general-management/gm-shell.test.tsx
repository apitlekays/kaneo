import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralManagementShell, type SectionKey } from "./gm-shell";

// Overview (rendered for admins) calls useQuery directly, so every render
// needs a real QueryClient in context.
function renderShell(props: {
  workspaceId: string;
  initialSection?: SectionKey;
}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralManagementShell {...props} />
    </QueryClientProvider>,
  );
}

// This suite only exercises gm-shell's own section-visibility logic, so the
// heavier sub-panels are stubbed out rather than exercised end-to-end —
// their own behaviour is covered by correspondence.test.tsx and friends.

const state = vi.hoisted(() => ({
  isAdmin: true,
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ isAdmin: state.isAdmin }),
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useCorrespondenceSummary: () => ({ data: undefined }),
}));

vi.mock("@/fetchers/correspondence", () => ({
  verifyAuditChain: () =>
    Promise.resolve({ ok: true, count: 0, brokenAtSeq: null }),
}));

vi.mock("./correspondence", () => ({
  Correspondence: () => <div data-testid="correspondence-panel" />,
}));

vi.mock("./settings", () => ({
  GeneralManagementSettings: () => <div data-testid="settings-panel" />,
}));

afterEach(cleanup);

describe("GeneralManagementShell section visibility", () => {
  it("shows every section to an admin", () => {
    state.isAdmin = true;
    renderShell({ workspaceId: "ws-1" });

    expect(screen.getByRole("button", { name: "Overview" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Correspondence" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Meeting Minutes" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  it("hides only the admin-only sections from a non-admin", () => {
    state.isAdmin = false;
    renderShell({ workspaceId: "ws-1" });

    expect(
      screen.queryByRole("button", { name: "Overview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Correspondence" }),
    ).toBeVisible();
    // Meeting Minutes is day-to-day work, not administration — a non-admin
    // with the General Management page must keep it.
    expect(
      screen.getByRole("button", { name: "Meeting Minutes" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("opens the Meeting Minutes panel when its tab is selected", async () => {
    const user = userEvent.setup();
    state.isAdmin = false;
    renderShell({ workspaceId: "ws-1" });

    await user.click(screen.getByRole("button", { name: "Meeting Minutes" }));

    // Tab and heading both read "Meeting Minutes": bare "Minutes" would be
    // ambiguous next to the project-level Minutes page and a letter's
    // minutes, which are unrelated features sharing the word.
    expect(
      screen.getByRole("heading", { name: "Meeting Minutes" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("correspondence-panel"),
    ).not.toBeInTheDocument();
  });

  it("falls back to Correspondence for a non-admin landing on a stale 'settings' link, instead of an empty shell", () => {
    state.isAdmin = false;
    renderShell({ workspaceId: "ws-1", initialSection: "settings" });

    expect(screen.getByTestId("correspondence-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-panel")).not.toBeInTheDocument();
  });
});
