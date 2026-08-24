import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const mutate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "ws-1" },
    isAdmin: true,
  }),
}));

vi.mock("@/hooks/queries/workspace-access/use-page-access-matrix", () => ({
  usePageAccessMatrix: () => ({ data: { grants: [] } }),
}));

vi.mock("@/hooks/queries/workspace-access/use-set-page-access", () => ({
  useSetPageAccess: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

let setGlobalAdminIsPending = false;

vi.mock("@/hooks/queries/workspace-access/use-set-global-admin", () => ({
  useSetGlobalAdmin: () => ({
    mutate,
    isPending: setGlobalAdminIsPending,
  }),
}));

type Member = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
};

let members: Member[] = [];

vi.mock("@/hooks/queries/workspace-access/use-workspace-members-list", () => ({
  useWorkspaceMembersList: () => ({ data: members }),
}));

// Imported after the mocks above (vitest hoists vi.mock calls to the top of
// the module, so this is safe as a normal static import).
import { Route } from "./access";

const RouteComponent = Route.options.component;
if (!RouteComponent) {
  throw new Error("access route has no component");
}

function globalAdminLabel(name: string) {
  return `${name} – settings:workspaceAccess.globalAdmin`;
}

describe("Access Management — Global Admin column", () => {
  beforeEach(() => {
    setGlobalAdminIsPending = false;
    mutate.mockClear();
  });

  it("renders an owner row's checkbox checked and disabled", () => {
    members = [
      {
        id: "u-1",
        name: "Olivia Owner",
        email: "olivia@example.com",
        image: null,
        role: "owner",
      },
    ];

    render(<RouteComponent />);

    const checkbox = screen.getByRole("checkbox", {
      name: globalAdminLabel("Olivia Owner"),
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
  });

  it("renders an admin row's checkbox checked and disabled", () => {
    members = [
      {
        id: "u-2",
        name: "Adam Admin",
        email: "adam@example.com",
        image: null,
        role: "admin",
      },
    ];

    render(<RouteComponent />);

    const checkbox = screen.getByRole("checkbox", {
      name: globalAdminLabel("Adam Admin"),
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
  });

  it("renders a member row's checkbox unchecked and enabled, and ticking it calls the mutation with enabled: true", async () => {
    members = [
      {
        id: "u-3",
        name: "Mia Member",
        email: "mia@example.com",
        image: null,
        role: "member",
      },
    ];

    render(<RouteComponent />);

    const checkbox = screen.getByRole("checkbox", {
      name: globalAdminLabel("Mia Member"),
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(checkbox);

    expect(mutate).toHaveBeenCalledWith({ userId: "u-3", enabled: true });
  });

  it("renders a global-admin row's checkbox checked and enabled, and unticking it calls the mutation with enabled: false", async () => {
    members = [
      {
        id: "u-4",
        name: "Gia GlobalAdmin",
        email: "gia@example.com",
        image: null,
        role: "global-admin",
      },
    ];

    render(<RouteComponent />);

    const checkbox = screen.getByRole("checkbox", {
      name: globalAdminLabel("Gia GlobalAdmin"),
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(checkbox);

    expect(mutate).toHaveBeenCalledWith({ userId: "u-4", enabled: false });
  });

  it("disables a global-admin row's per-page checkboxes, since the role already grants every page", () => {
    members = [
      {
        id: "u-5",
        name: "Gia GlobalAdmin",
        email: "gia@example.com",
        image: null,
        role: "global-admin",
      },
    ];

    render(<RouteComponent />);

    const checkboxes = screen.getAllByRole("checkbox");
    // The Global Admin column's own checkbox stays editable for this row —
    // only the per-page checkboxes (everything else) should be locked,
    // since the role already grants every page.
    const perPageCheckboxes = checkboxes.filter(
      (checkbox) =>
        checkbox.getAttribute("aria-label") !==
        globalAdminLabel("Gia GlobalAdmin"),
    );
    expect(perPageCheckboxes.length).toBeGreaterThan(0);
    for (const checkbox of perPageCheckboxes) {
      expect(checkbox).toBeChecked();
      expect(checkbox).toHaveAttribute("aria-disabled", "true");
    }
  });
});
