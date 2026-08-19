import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingDecisionError } from "@/fetchers/pending-decision";
import { PendingDecisionDialog } from "./pending-decision-dialog";

const mutate = vi.fn();
const items = {
  current: [
    {
      source: "correspondence",
      id: "l1:a1",
      title: "MAPIM/2026/0114",
      subtitle: "Permohonan kerjasama",
      context: ["Action: For your action"],
      href: "/dashboard/correspondence/l1",
      createdAt: "2026-08-19T00:00:00.000Z",
      requiresReason: true,
    },
  ],
};

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/queries/pending-decision/use-pending-decisions", () => ({
  usePendingDecisions: () => ({
    data: { items: items.current, failedSources: [] },
  }),
}));
vi.mock("@/hooks/mutations/pending-decision/use-decide-pending", () => ({
  useDecidePending: () => ({ mutate, isPending: false }),
}));

const errorToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  toast: { error: (m: string) => errorToast(m), info: vi.fn() },
}));

const pathname = { current: "/dashboard/correspondence/l1" };
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: pathname.current }),
  useNavigate: () => navigate,
}));

describe("PendingDecisionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mutate.mockReset();
    errorToast.mockReset();
    navigate.mockReset();
    pathname.current = "/dashboard/correspondence/l1";
    items.current = [
      {
        source: "correspondence",
        id: "l1:a1",
        title: "MAPIM/2026/0114",
        subtitle: "Permohonan kerjasama",
        context: ["Action: For your action"],
        href: "/dashboard/correspondence/l1",
        createdAt: "2026-08-19T00:00:00.000Z",
        requiresReason: true,
      },
    ];
  });

  it("shows the pending item when work is waiting", async () => {
    render(<PendingDecisionDialog />);
    expect(await screen.findByText("MAPIM/2026/0114")).toBeInTheDocument();
    expect(screen.getByText("Permohonan kerjasama")).toBeInTheDocument();
  });

  it("accepts with one click and no reason", async () => {
    render(<PendingDecisionDialog />);
    await userEvent.click(
      await screen.findByRole("button", { name: /accept/i }),
    );
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "l1:a1",
        decision: "accepted",
        reason: null,
      }),
      expect.anything(),
    );
  });

  it("will not submit a rejection until a reason is written", async () => {
    render(<PendingDecisionDialog />);
    await userEvent.click(
      await screen.findByRole("button", { name: /reject/i }),
    );

    const confirm = screen.getByRole("button", { name: /confirm rejection/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "Wrong department");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "rejected",
        reason: "Wrong department",
      }),
      expect.anything(),
    );
  });

  it("treats a 409 as already handled, with no error toast", async () => {
    mutate.mockImplementation((_args, opts) => {
      opts.onError(new PendingDecisionError(409, "already decided"));
    });
    render(<PendingDecisionDialog />);
    await userEvent.click(
      await screen.findByRole("button", { name: /accept/i }),
    );

    expect(await screen.findByText(/already handled/i)).toBeInTheDocument();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("shouts about a real failure", async () => {
    mutate.mockImplementation((_args, opts) => {
      opts.onError(new PendingDecisionError(500, "boom"));
    });
    render(<PendingDecisionDialog />);
    await userEvent.click(
      await screen.findByRole("button", { name: /accept/i }),
    );

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
  });

  it("never plays a chime — AppAlerts owns the audio", async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play");
    render(<PendingDecisionDialog />);
    await screen.findByText("MAPIM/2026/0114");
    expect(play).not.toHaveBeenCalled();
  });

  it("navigates client-side and closes the dialog when Open is clicked", async () => {
    render(<PendingDecisionDialog />);
    expect(await screen.findByText("MAPIM/2026/0114")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: /open/i }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/dashboard/correspondence/l1",
    });
    // A full page reload would remount the dialog with dismissed=false and
    // it would auto-open again on top of the very item just opened; closing
    // it here (and staying dismissed) is what proves this isn't a reload.
    await waitFor(() =>
      expect(screen.queryByText("MAPIM/2026/0114")).not.toBeInTheDocument(),
    );
  });

  it("stays dismissed away from Home, but reopens once the user lands there", async () => {
    const { rerender } = render(<PendingDecisionDialog />);
    expect(await screen.findByText("MAPIM/2026/0114")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("MAPIM/2026/0114")).not.toBeInTheDocument();

    // Still on the same page, work is still pending: the dismissal holds.
    rerender(<PendingDecisionDialog />);
    expect(screen.queryByText("MAPIM/2026/0114")).not.toBeInTheDocument();

    // Landing on Home clears the dismissal and the dialog reopens.
    pathname.current = "/dashboard/home";
    rerender(<PendingDecisionDialog />);
    expect(await screen.findByText("MAPIM/2026/0114")).toBeInTheDocument();
  });
});
