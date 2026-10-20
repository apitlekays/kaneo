import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async () => ({}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// One stable object, as the real session gives: a fresh object on every
// render would re-run the page's reset effect forever.
const auth = {
  user: { id: "u-1", name: "Old Name", email: "old@example.com" },
};

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => auth,
}));

vi.mock("@/hooks/mutations/use-update-user-profile", () => ({
  default: () => ({ mutateAsync: updateProfile, isPending: false }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { Route } from "./information";

const RouteComponent = Route.options.component;
if (!RouteComponent) throw new Error("information route has no component");

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouteComponent />
    </QueryClientProvider>,
  );
}

describe("Personal Information: saving the name", () => {
  beforeEach(() => updateProfile.mockClear());

  it("keeps Save disabled until the name changes, then saves it", async () => {
    renderPage();
    const save = screen.getByRole("button", {
      name: "settings:informationPage.saveName",
    });
    expect(save).toBeDisabled();

    const input = screen.getByPlaceholderText(
      "settings:informationPage.fullNamePlaceholder",
    );
    await userEvent.clear(input);
    await userEvent.type(input, "  New Name ");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ name: "New Name" }),
    );
    await waitFor(() => expect(save).toBeDisabled());
  });

  it("saves on Enter", async () => {
    renderPage();
    const input = screen.getByPlaceholderText(
      "settings:informationPage.fullNamePlaceholder",
    );
    await userEvent.clear(input);
    await userEvent.type(input, "Another Name{Enter}");
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ name: "Another Name" }),
    );
  });
});
