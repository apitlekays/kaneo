import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskAssignee } from "@/types/task";
import { AvatarStack } from "./avatar-stack";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

function person(userId: string, isLead = false): TaskAssignee {
  return { userId, name: `User ${userId}`, image: null, isLead };
}

describe("AvatarStack", () => {
  it("renders nothing when nobody is on the task or offered it", () => {
    const { container } = render(<AvatarStack assignees={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the lead first and marks it", () => {
    render(<AvatarStack assignees={[person("a", true), person("b")]} />);
    const labelled = screen
      .getAllByLabelText(/User/)
      .map((el) => el.getAttribute("aria-label"));
    expect(labelled[0]).toContain("tasks:assignee.lead");
    expect(labelled[0]).toContain("User a");
    expect(labelled[1]).toBe("User b");
    expect(screen.getAllByLabelText(/User/)[0]?.getAttribute("data-lead")).toBe(
      "true",
    );
  });

  it("draws pending people as pending badges after the assignees", () => {
    render(
      <AvatarStack
        assignees={[person("a", true)]}
        pending={[{ userId: "c", name: "User c" }]}
      />,
    );
    const pendingBadge = screen.getByTitle(/tasks:assignee.awaiting/);
    expect(pendingBadge.getAttribute("title")).toContain("User c");
    // Never drawn as a real avatar.
    expect(screen.queryByLabelText("User c")).toBeNull();
  });

  it("collapses everyone past the limit into a +N chip that names them", () => {
    render(
      <AvatarStack
        max={3}
        assignees={[person("a", true), person("b"), person("c")]}
        pending={[{ userId: "d", name: "User d" }]}
      />,
    );
    // Two circles plus a chip standing for the other two.
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("+2").getAttribute("title")).toBe("User c, User d");
  });

  it("shows everyone without a chip when they fit", () => {
    render(
      <AvatarStack max={3} assignees={[person("a", true), person("b")]} />,
    );
    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
