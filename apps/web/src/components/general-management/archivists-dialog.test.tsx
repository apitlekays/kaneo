import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchivistsDialog } from "./past-minute-dialogs";

const add = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/meeting/use-past-minutes", () => ({
  useMeetingArchivists: () => ({
    data: [{ userId: "u-1", name: "Aminah", email: "aminah@example.test" }],
    isLoading: false,
  }),
  useArchivistMutations: () => ({
    add: { mutate: add, isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          {
            userId: "u-1",
            user: { name: "Aminah", email: "aminah@example.test" },
          },
          {
            userId: "u-2",
            user: { name: "Badrul", email: "badrul@example.test" },
          },
          {
            userId: "u-3",
            user: { name: "Chong", email: "chong@example.test" },
          },
          { userId: "u-4", user: { name: "Devi", email: "devi@example.test" } },
        ],
      },
    }),
  }),
);

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ArchivistsDialog workspaceId="ws-1" open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("ArchivistsDialog", () => {
  it("adds several people in one go and hides existing archivists", async () => {
    const user = userEvent.setup();
    renderDialog();

    // Aminah is already an archivist, so she is listed but not offered.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("Current archivists (1)")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Badrul/ }));
    await user.click(screen.getByRole("checkbox", { name: /Devi/ }));
    await user.click(screen.getByRole("button", { name: "Add 2 archivists" }));

    expect(add).toHaveBeenCalledWith(["u-2", "u-4"], expect.anything());
  });

  it("filters the people to choose from", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Add people"), "chong");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /Chong/ })).toBeInTheDocument();
  });
});
