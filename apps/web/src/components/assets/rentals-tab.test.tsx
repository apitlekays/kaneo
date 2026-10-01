import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { Asset, AssetRental } from "@/fetchers/asset-registry";

const api = vi.hoisted(() => ({
  getAssetRentals: vi.fn(),
  createAssetRental: vi.fn(),
  updateAssetRental: vi.fn(),
  returnAssetRental: vi.fn(),
  deleteAssetRental: vi.fn(),
}));
vi.mock("@/fetchers/asset-registry", () => api);
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RentalsTab } from "./rentals-tab";

const asset = {
  id: "asset-1",
  name: "PA System",
  status: "active",
  currency: "MYR",
} as Asset;

function rental(overrides: Partial<AssetRental> = {}): AssetRental {
  return {
    id: "r1",
    assetId: "asset-1",
    renterName: "Ahmad bin Ali",
    renterOrganisation: "Persatuan Belia",
    renterPhone: "012-3456789",
    renterEmail: null,
    renterIdNumber: null,
    purpose: null,
    startAt: "2026-10-01T09:00:00.000Z",
    dueAt: "2999-01-01T00:00:00.000Z",
    returnedAt: null,
    rate: 15000,
    ratePeriod: "day",
    deposit: 50000,
    depositReturned: false,
    currency: "MYR",
    conditionOut: null,
    conditionIn: null,
    notes: null,
    createdBy: "u1",
    createdByName: "Hafiz",
    createdAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function renderTab(target: Asset = asset) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryClientProvider>
  );
  return render(<RentalsTab asset={target} workspaceId="ws-1" />, {
    wrapper,
  });
}

describe("RentalsTab", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("offers to rent out an asset that is not on rent", async () => {
    api.getAssetRentals.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText("Not on rent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rent out/ })).toBeEnabled();
  });

  it("will not rent out a disposed asset", async () => {
    api.getAssetRentals.mockResolvedValue([]);
    renderTab({ ...asset, status: "disposed" });
    expect(
      await screen.findByText("A disposed asset cannot be rented out."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rent out/ })).toBeDisabled();
  });

  it("records a rental with the renter's details", async () => {
    const user = userEvent.setup();
    api.getAssetRentals.mockResolvedValue([]);
    api.createAssetRental.mockResolvedValue(rental());
    renderTab();

    await user.click(await screen.findByRole("button", { name: /Rent out/ }));
    const submit = screen.getByRole("button", { name: "Record rental" });
    // A renter name is required.
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText("Person collecting it"),
      "Ahmad bin Ali",
    );
    await user.type(screen.getByPlaceholderText("Blank = free"), "150");
    await user.click(submit);

    await waitFor(() => expect(api.createAssetRental).toHaveBeenCalled());
    const [, assetId, body] = api.createAssetRental.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(assetId).toBe("asset-1");
    expect(body).toMatchObject({
      renterName: "Ahmad bin Ali",
      rate: 15000,
      ratePeriod: "day",
    });
  });

  it("shows who has it and lets it be marked returned", async () => {
    const user = userEvent.setup();
    api.getAssetRentals.mockResolvedValue([rental()]);
    api.returnAssetRental.mockResolvedValue(rental());
    renderTab();

    expect(await screen.findByText("On rent")).toBeInTheDocument();
    expect(screen.getByText("Ahmad bin Ali")).toBeInTheDocument();
    expect(screen.getByText("Persatuan Belia")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mark returned/ }));
    await user.type(
      screen.getByPlaceholderText("Anything missing or damaged?"),
      "Cable missing",
    );
    await user.click(screen.getByRole("button", { name: "Mark returned" }));

    await waitFor(() => expect(api.returnAssetRental).toHaveBeenCalled());
    const body = api.returnAssetRental.mock.calls[0]?.[3];
    expect(body).toMatchObject({
      conditionIn: "Cable missing",
      depositReturned: true,
    });
  });

  it("marks a rental past its return date as overdue", async () => {
    api.getAssetRentals.mockResolvedValue([
      rental({ dueAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    renderTab();
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
  });

  it("lists returned rentals as history and flags a late return", async () => {
    api.getAssetRentals.mockResolvedValue([
      rental({
        id: "r-old",
        dueAt: "2026-09-02T00:00:00.000Z",
        startAt: "2026-09-01T00:00:00.000Z",
        returnedAt: "2026-09-05T00:00:00.000Z",
        conditionIn: "Fine",
      }),
    ]);
    renderTab();
    expect(await screen.findByText("Not on rent")).toBeInTheDocument();
    expect(screen.getByText("Returned late")).toBeInTheDocument();
    expect(screen.getByText("Came back: Fine")).toBeInTheDocument();
  });
});
