import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TypedConfirmDialog } from "./typed-confirm-dialog";

function setup() {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TypedConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete asset?"
      identifiers={[
        { label: "Name", value: "PA System" },
        { label: "Serial no.", value: "AST-7Q2K9P" },
      ]}
      confirmText="Delete asset"
      onConfirm={onConfirm}
    />,
  );
  return {
    onConfirm,
    onOpenChange,
    input: screen.getByLabelText(/to confirm/),
    button: screen.getByRole("button", { name: "Delete asset" }),
  };
}

describe("TypedConfirmDialog", () => {
  it("shows the name and the ID the user can type", () => {
    setup();
    expect(screen.getByText("PA System")).toBeInTheDocument();
    expect(screen.getByText("AST-7Q2K9P")).toBeInTheDocument();
  });

  it("keeps the delete button disabled until the name or ID is typed exactly", async () => {
    const { input, button, onConfirm } = setup();
    expect(button).toBeDisabled();

    await userEvent.type(input, "PA Syste");
    expect(button).toBeDisabled();
    await userEvent.type(input, "m");
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("also accepts the ID, and ignores surrounding spaces", async () => {
    const { input, button } = setup();
    await userEvent.type(input, "  AST-7Q2K9P ");
    expect(button).toBeEnabled();
  });

  it("does not accept a case-insensitive near miss", async () => {
    const { input, button } = setup();
    await userEvent.type(input, "pa system");
    expect(button).toBeDisabled();
  });

  it("does not confirm on Enter until it matches", async () => {
    const { input, onConfirm } = setup();
    await userEvent.type(input, "nope{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("copies an identifier to the clipboard", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Copy serial no." }));
    expect(await navigator.clipboard.readText()).toBe("AST-7Q2K9P");
  });
});
