import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyCorrespondence as MyCorrespondenceData } from "@/fetchers/correspondence/letters";
import MyCorrespondence from "./my-correspondence";

const openedLetterIds: (string | null)[] = [];

vi.mock("@/components/general-management/letter-detail-dialog", () => ({
  LetterDetailDialog: ({ letterId }: { letterId: string | null }) => {
    openedLetterIds.push(letterId);
    return letterId ? <div data-testid="letter-dialog">{letterId}</div> : null;
  },
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

const data = vi.hoisted(() => ({
  current: undefined as MyCorrespondenceData | undefined,
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useMyCorrespondence: () => ({ data: data.current }),
}));

const pendingOnly: MyCorrespondenceData = {
  letters: [],
  actions: [],
  pendingAssignments: [
    {
      id: "assign-1",
      letterId: "letter-9",
      refNo: null,
      subject: "Permohonan cuti tanpa rekod",
      action: "inspect",
      note: "Sila ambil tindakan",
      createdAt: "2026-08-18T02:00:00.000Z",
    },
  ],
};

describe("MyCorrespondence", () => {
  // vitest runs without `globals`, so testing-library's auto-cleanup is off.
  afterEach(cleanup);

  it("renders the awaiting-decision section when it is the only work", () => {
    // The Home dot is fed by pendingAssignments alone, so a card that hides
    // them sends the user to a page with nothing to click.
    data.current = pendingOnly;
    render(<MyCorrespondence />);

    expect(screen.getByText("Awaiting your decision")).toBeVisible();
    expect(screen.getByText("Permohonan cuti tanpa rekod")).toBeVisible();
  });

  it("opens the letter dialog for the pending assignment's letter", () => {
    data.current = pendingOnly;
    openedLetterIds.length = 0;
    render(<MyCorrespondence />);

    fireEvent.click(
      screen.getByRole("button", { name: /Permohonan cuti tanpa rekod/ }),
    );

    expect(openedLetterIds[openedLetterIds.length - 1]).toBe("letter-9");
  });

  it("counts pending assignments in the header total", () => {
    data.current = {
      ...pendingOnly,
      letters: [
        {
          id: "letter-1",
          refNo: "KKM/2026/1",
          subject: "Surat siasatan",
          direction: "in",
          status: "assigned",
          receivedAt: null,
          createdAt: "2026-08-18T01:00:00.000Z",
        },
      ],
    };
    render(<MyCorrespondence />);

    expect(screen.getByText("Correspondence (2)")).toBeVisible();
  });

  it("renders nothing when there is no correspondence at all", () => {
    data.current = { letters: [], actions: [], pendingAssignments: [] };
    const { container } = render(<MyCorrespondence />);

    expect(container).toBeEmptyDOMElement();
  });
});
