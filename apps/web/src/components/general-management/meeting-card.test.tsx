import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MeetingListItem } from "@/fetchers/meeting";
import { MeetingCard } from "./meeting-card";

function makeMeeting(
  overrides: Partial<MeetingListItem> = {},
): MeetingListItem {
  return {
    id: "meeting-1",
    workspaceId: "ws-1",
    title: "Q3 Committee Meeting",
    meetingTypeId: "type-committee",
    bodyId: null,
    scheduledAt: "2026-03-01T12:00:00.000Z",
    location: null,
    confidential: false,
    status: "draft",
    adoptedAt: null,
    adoptedByMeetingId: null,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    meetingTypeLabel: "Committee Meeting",
    bodyName: null,
    ...overrides,
  };
}

describe("MeetingCard", () => {
  it("shows the title and its metadata", () => {
    render(<MeetingCard meeting={makeMeeting()} onOpen={vi.fn()} />);
    expect(screen.getByText("Q3 Committee Meeting")).toBeInTheDocument();
    expect(screen.getByText("Committee Meeting")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows the type label, never the raw id", () => {
    render(<MeetingCard meeting={makeMeeting()} onOpen={vi.fn()} />);
    expect(screen.queryByText("type-committee")).not.toBeInTheDocument();
  });

  it("clamps a long title instead of letting it grow the card", () => {
    const title = "A ".repeat(200).trim();
    render(<MeetingCard meeting={makeMeeting({ title })} onOpen={vi.fn()} />);
    const heading = screen.getByText(title);
    expect(heading.className).toContain("line-clamp-");
  });

  it("marks a confidential meeting", () => {
    render(
      <MeetingCard
        meeting={makeMeeting({ confidential: true })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Confidential")).toBeInTheDocument();
  });

  it("is a real focusable button that opens the meeting", async () => {
    const onOpen = vi.fn();
    render(<MeetingCard meeting={makeMeeting()} onOpen={onOpen} />);
    const card = screen.getByRole("button", { name: /Q3 Committee Meeting/ });
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders an em dash rather than blank metadata when unset", () => {
    render(
      <MeetingCard
        meeting={makeMeeting({ scheduledAt: null, meetingTypeLabel: null })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
