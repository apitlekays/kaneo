import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm";

const api = vi.hoisted(() => ({
  listCommittees: vi.fn(),
  listCommitteeMembers: vi.fn(),
  listOfficeHolders: vi.fn(),
  createCommittee: vi.fn(),
  updateCommittee: vi.fn(),
  addCommitteeMember: vi.fn(),
  updateCommitteeMember: vi.fn(),
  setOfficeHolder: vi.fn(),
}));
vi.mock("@/fetchers/committees", () => api);
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const permission = vi.hoisted(() => ({ isAdmin: false }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => permission,
}));
vi.mock("@/components/assets/member-picker", () => ({
  MemberPicker: ({ trigger }: { trigger: ReactNode }) => trigger,
}));

import { Committees } from "./committees";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <Committees workspaceId="ws-1" />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("Committees", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.listCommittees.mockResolvedValue([
      {
        id: "b1",
        workspaceId: "ws-1",
        name: "Jawatankuasa Pelupusan Aset",
        description: null,
        quorumRule: null,
        active: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    api.listCommitteeMembers.mockResolvedValue([
      {
        id: "m1",
        bodyId: "b1",
        userId: "u1",
        name: null,
        displayName: "Encik Razak",
        userEmail: null,
        userImage: null,
        role: "member",
        active: true,
      },
    ]);
    api.listOfficeHolders.mockResolvedValue([
      {
        key: "ceo",
        label: "Chief Executive Officer",
        holderUserId: "ceo",
        holderName: "Dato' CEO",
        holderImage: null,
        actingUserId: null,
        actingName: null,
        actingImage: null,
      },
    ]);
  });

  it("is read-only for someone who is not a global admin", async () => {
    permission.isAdmin = false;
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Dato' CEO")).toBeInTheDocument();
    expect(
      screen.getByText(/Only global admins can make changes/),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/New committee/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Jawatankuasa/ }));
    expect(await screen.findByText("Encik Razak")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove Encik Razak/ }),
    ).toBeNull();
  });

  it("lets a global admin add committees and edit members, and warns when there is no chair", async () => {
    permission.isAdmin = true;
    const user = userEvent.setup();
    api.createCommittee.mockResolvedValue({});
    renderPage();

    await user.type(
      await screen.findByPlaceholderText(/New committee/),
      "Jawatankuasa Audit",
    );
    await user.click(screen.getByRole("button", { name: /Add/ }));
    expect(api.createCommittee).toHaveBeenCalledWith("ws-1", {
      name: "Jawatankuasa Audit",
    });

    await user.click(
      screen.getByRole("button", { name: /Jawatankuasa Pelupusan/ }),
    );
    expect(await screen.findByText(/No chair set/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Encik Razak" }),
    ).toBeInTheDocument();
  });
});
