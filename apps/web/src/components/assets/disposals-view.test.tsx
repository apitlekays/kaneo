import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/fetchers/asset-registry", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDisposalRequests: vi.fn().mockResolvedValue([]),
  getDisposalSettings: vi.fn().mockResolvedValue({
    committeeBodyId: "ypb7a2jlda45nagbxruzyijq",
    committeeName: "Jawatankuasa Pelupusan Aset",
    chairName: "Encik Razak",
    secretaryName: null,
    canEdit: true,
  }),
  setDisposalSettings: vi.fn(),
}));
vi.mock("@/fetchers/committees", () => ({
  listCommittees: vi.fn().mockResolvedValue([
    {
      id: "ypb7a2jlda45nagbxruzyijq",
      workspaceId: "ws-1",
      name: "Jawatankuasa Pelupusan Aset",
      description: null,
      quorumRule: null,
      active: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ]),
  listOfficeHolders: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DisposalsView } from "./disposals-view";

describe("DisposalsView", () => {
  it("shows the chosen committee by name, never its id", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DisposalsView workspaceId="ws-1" onOpenAsset={vi.fn()} />
      </QueryClientProvider>,
    );
    const picker = await screen.findByRole("combobox", {
      name: "Disposal committee",
    });
    expect(
      await screen.findByText("Jawatankuasa Pelupusan Aset"),
    ).toBeInTheDocument();
    expect(picker).not.toHaveTextContent("ypb7a2jlda45nagbxruzyijq");
  });
});
