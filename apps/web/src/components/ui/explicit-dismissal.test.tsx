import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/**
 * Site-wide rule: a dialog or sheet is dismissed deliberately — Cancel,
 * Close or X — never by clicking the backdrop. These dialogs hold
 * half-finished letters, minute items and memoranda, and a stray backdrop
 * click used to discard the lot with no warning and no undo.
 *
 * The rule lives as an inverted default inside `ui/dialog.tsx` and
 * `ui/sheet.tsx` rather than at the ~20 call sites, so this file guards the
 * default itself. Delete `disablePointerDismissal = true` from either
 * wrapper and the first test in each pair fails.
 *
 * Escape closing is asserted too, and that is NOT a contradiction: Escape is
 * a deliberate keystroke rather than a slip, and WAI-ARIA expects a modal to
 * close on it. If someone "tightens" the rule by blocking Escape, the second
 * test in each pair fails and points them at this comment.
 */

function OpenDialog() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Capture letter</DialogTitle>
        <DialogDescription>Unsaved work lives here.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

function OpenSheet() {
  return (
    <Sheet defaultOpen>
      <SheetContent>
        <SheetTitle>Filters</SheetTitle>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Click the backdrop, not the panel. Base UI renders the backdrop as a
 * sibling element covering the viewport; clicking the dialog's own content
 * would prove nothing because that never dismissed anything.
 */
async function clickBackdrop(user: ReturnType<typeof userEvent.setup>) {
  const backdrop = document.querySelector("[data-slot$='-backdrop']");
  expect(backdrop).not.toBeNull();
  await user.click(backdrop as Element);
}

describe("dialogs are dismissed explicitly, never by the backdrop", () => {
  it("stays open when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<OpenDialog />);
    expect(screen.getByText("Capture letter")).toBeInTheDocument();

    await clickBackdrop(user);

    // Still there. If this fails, someone removed the inverted default in
    // ui/dialog.tsx and every dialog in the app now discards work on a
    // stray click.
    expect(screen.getByText("Capture letter")).toBeInTheDocument();
  });

  it("still closes on Escape, which is deliberate and required for a11y", async () => {
    const user = userEvent.setup();
    render(<OpenDialog />);
    expect(screen.getByText("Capture letter")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Capture letter")).not.toBeInTheDocument();
  });
});

describe("sheets are dismissed explicitly, never by the backdrop", () => {
  it("stays open when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<OpenSheet />);
    expect(screen.getByText("Filters")).toBeInTheDocument();

    await clickBackdrop(user);

    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  it("still closes on Escape", async () => {
    const user = userEvent.setup();
    render(<OpenSheet />);
    expect(screen.getByText("Filters")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
  });
});

describe("the escape hatch still works", () => {
  it("honours an explicit disablePointerDismissal={false}", async () => {
    // The rule is a DEFAULT, not a prohibition — a dialog that genuinely
    // wants backdrop dismissal can still ask for it. If this stops working,
    // the wrapper has started ignoring caller intent, which is a different
    // bug from the one above.
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen disablePointerDismissal={false}>
        <DialogContent>
          <DialogTitle>Opt out</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Opt out")).toBeInTheDocument();

    await clickBackdrop(user);

    expect(screen.queryByText("Opt out")).not.toBeInTheDocument();
  });
});
