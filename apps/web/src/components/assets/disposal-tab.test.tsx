import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, DisposalRequest } from "@/fetchers/asset-registry";

const api = vi.hoisted(() => ({
  getAssetDisposalRequests: vi.fn(),
  proposeDisposal: vi.fn(),
  withdrawDisposal: vi.fn(),
}));
vi.mock("@/fetchers/asset-registry", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "custodian" } } }) },
}));

import { DisposalTab } from "./disposal-tab";

const asset = {
  id: "asset-1",
  name: "Dell Latitude 5420",
  serialNumber: "AST-DELL01",
  status: "active",
  currentCustodianId: "custodian",
} as Asset;

function request(overrides: Partial<DisposalRequest> = {}): DisposalRequest {
  return {
    id: "req-1",
    assetId: "asset-1",
    status: "proposed",
    reasonCategory: "beyond-repair",
    proposedBy: "custodian",
    proposerName: "Aisyah",
    pendingDeciderId: "chair",
    pendingDeciderName: "Encik Razak",
    createdAt: "2026-10-02T09:00:00.000Z",
    decidedAt: null,
    steps: [
      {
        id: "s1",
        requestId: "req-1",
        stage: "proposed",
        outcome: "proposed",
        actorUserId: "custodian",
        actorName: "Aisyah",
        actedAs: "custodian",
        justification: "Motherboard failed; repair quote exceeds replacement.",
        createdAt: "2026-10-02T09:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function renderTab(target: Asset = asset) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <DisposalTab
      asset={target}
      workspaceId="ws-1"
      onRecordDisposal={vi.fn()}
    />,
    { wrapper },
  );
}

describe("DisposalTab", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("only lets the custodian propose an asset that has one", async () => {
    api.getAssetDisposalRequests.mockResolvedValue([]);
    renderTab({ ...asset, currentCustodianId: "someone-else" });
    expect(
      await screen.findByText(
        "Only this asset's custodian can propose it for disposal.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Propose disposal/ }),
    ).toBeDisabled();
  });

  it("will not propose until reason, justification, confirmation and serial are all given", async () => {
    const user = userEvent.setup();
    api.getAssetDisposalRequests.mockResolvedValue([]);
    api.proposeDisposal.mockResolvedValue(request());
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: /Propose disposal/ }),
    );
    // The form's submit button, not the one that opened it.
    const submit = screen
      .getAllByRole("button", { name: /Propose disposal/ })
      .at(-1) as HTMLElement;
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Reason" }));
    await user.click(await screen.findByRole("option", { name: "Obsolete" }));
    await user.type(screen.getByLabelText(/Justification/), "Too old");
    expect(screen.getByText(/more characters needed/)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/Justification/),
      " — cannot run the current OS or receive security updates.",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByLabelText(/serial number/), "AST-DELL0");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/serial number/), "1");
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => expect(api.proposeDisposal).toHaveBeenCalled());
    expect(api.proposeDisposal.mock.calls[0]?.[2]).toMatchObject({
      reasonCategory: "obsolete",
      confirmServiceable: true,
      confirmSerial: "AST-DELL01",
    });
  });

  it("shows the decision trail with every justification", async () => {
    api.getAssetDisposalRequests.mockResolvedValue([
      request({
        status: "awaiting_ceo",
        pendingDeciderName: "Dato' CEO",
        steps: [
          ...request().steps,
          {
            id: "s2",
            requestId: "req-1",
            stage: "chair",
            outcome: "supported",
            actorUserId: "chair",
            actorName: "Encik Razak",
            actedAs: "chair",
            justification: "Agreed at the October sitting.",
            createdAt: "2026-10-03T09:00:00.000Z",
          },
        ],
      }),
    ]);
    renderTab();
    expect(
      await screen.findByText("Awaiting CEO approval"),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting on Dato' CEO")).toBeInTheDocument();
    expect(
      screen.getByText(/Agreed at the October sitting/),
    ).toBeInTheDocument();
    expect(screen.getByText(/committee chair/)).toBeInTheDocument();
    // Past the committee, it can no longer be withdrawn.
    expect(screen.queryByRole("button", { name: /Withdraw/ })).toBeNull();
  });

  it("lets the proposer withdraw while it awaits the committee, with a reason", async () => {
    const user = userEvent.setup();
    api.getAssetDisposalRequests.mockResolvedValue([request()]);
    api.withdrawDisposal.mockResolvedValue({ success: true });
    renderTab();

    await user.click(await screen.findByRole("button", { name: /Withdraw/ }));
    const confirmWithdraw = screen.getByRole("button", {
      name: "Withdraw proposal",
    });
    expect(confirmWithdraw).toBeDisabled();
    await user.type(
      screen.getByLabelText("Reason for withdrawing"),
      "Found a spare part",
    );
    await user.click(confirmWithdraw);
    await waitFor(() =>
      expect(api.withdrawDisposal).toHaveBeenCalledWith(
        "ws-1",
        "asset-1",
        "req-1",
        "Found a spare part",
      ),
    );
  });
});
