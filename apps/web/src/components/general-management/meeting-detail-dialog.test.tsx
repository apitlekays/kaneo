import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meeting, MeetingDetail } from "@/fetchers/meeting";
import { MeetingDetailDialog } from "./meeting-detail-dialog";

// Mock every query/mutation hook the dialog touches, the same way
// minutes-manager.test.tsx mocks its sibling hooks — this suite is about the
// dialog's own wiring (which mutation gets called with what), not the
// network/invalidation contract those hooks already cover elsewhere.

const state = vi.hoisted(() => ({
  meeting: null as MeetingDetail | null,
  adoptCandidates: [] as Meeting[],
  meetingIsLoading: false,
  meetingIsError: false,
  isMeetingsError: false,
}));

const refetchMeeting = vi.hoisted(() => vi.fn());
const useAdoptCandidatesMock = vi.hoisted(() => vi.fn());

const mutations = vi.hoisted(() => ({
  addAttendee: { mutate: vi.fn(), isPending: false },
  removeAttendee: { mutate: vi.fn(), isPending: false },
  addMinuteItem: { mutate: vi.fn(), isPending: false },
  updateMinuteItem: { mutate: vi.fn(), isPending: false },
  addAction: { mutate: vi.fn(), isPending: false },
  adopt: { mutate: vi.fn(), isPending: false },
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/hooks/queries/meeting/use-meeting", () => ({
  useMeeting: () => ({
    data: state.meeting,
    isLoading: state.meetingIsLoading,
    isError: state.meetingIsError,
    refetch: refetchMeeting,
  }),
}));

vi.mock("@/hooks/queries/meeting/use-adopt-candidates", () => ({
  useAdoptCandidates: (...args: unknown[]) => {
    useAdoptCandidatesMock(...args);
    return {
      data: { items: state.adoptCandidates, nextCursor: null },
      isError: state.isMeetingsError,
    };
  },
}));

vi.mock("@/hooks/queries/meeting/use-meeting-mutations", () => ({
  useMeetingMutations: () => mutations,
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "user-1", user: { name: "Alice Officer" } },
          { userId: "user-2", user: { name: "Bob Assignee" } },
        ],
      },
    }),
  }),
);

function makeMeeting(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return {
    id: "meeting-1",
    workspaceId: "ws-1",
    title: "Q3 Committee Meeting",
    meetingTypeId: null,
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
    attendees: [],
    minuteItems: [
      {
        id: "item-1",
        meetingId: "meeting-1",
        position: 0,
        agenda: "Approve the annual budget",
        discussion: null,
        decision: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    actions: [],
    adoptedByMeeting: null,
    ...overrides,
  };
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(
    await screen.findByRole("tab", { name: new RegExp(name, "i") }),
  );
}

async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  triggerText: string,
  optionName: string,
) {
  // The Select trigger's accessible name isn't computed from its visible
  // placeholder text (role="combobox" takes its name from author-supplied
  // labelling only), so locate it by the text itself rather than by role
  // name — this is exactly what a sighted user sees before opening it.
  const trigger = screen.getByText(triggerText).closest('[role="combobox"]');
  if (!trigger)
    throw new Error(`No combobox trigger found for "${triggerText}"`);
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: optionName }));
}

afterEach(() => {
  state.meeting = null;
  state.adoptCandidates = [];
  state.meetingIsLoading = false;
  state.meetingIsError = false;
  state.isMeetingsError = false;
  refetchMeeting.mockClear();
  useAdoptCandidatesMock.mockClear();
  for (const m of Object.values(mutations)) {
    m.mutate.mockClear();
    m.isPending = false;
  }
});

describe("MeetingDetailDialog", () => {
  it("1. adding an attendee with a linked workspace user calls addAttendee with userId, not name", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting();

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Attendees");
    await pickOption(user, "Select workspace user", "Bob Assignee");
    await user.click(screen.getByRole("button", { name: /add attendee/i }));

    expect(mutations.addAttendee.mutate).toHaveBeenCalledWith(
      { userId: "user-2", attendance: "present" },
      expect.anything(),
    );
  });

  it("1b. adding an attendee with an outside name calls addAttendee with name, not userId", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting();

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Attendees");
    await user.click(screen.getByRole("button", { name: /outside guest/i }));
    await user.type(screen.getByPlaceholderText(/guest's name/i), "Jane Guest");
    await user.click(screen.getByRole("button", { name: /add attendee/i }));

    expect(mutations.addAttendee.mutate).toHaveBeenCalledWith(
      { name: "Jane Guest", attendance: "present" },
      expect.anything(),
    );
  });

  it("2. switching from a linked user to an outside name clears the user — the form never submits both", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting();

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Attendees");
    // Pick a workspace user first...
    await pickOption(user, "Select workspace user", "Bob Assignee");
    // ...then switch to the outside-guest mode and fill in a name instead.
    await user.click(screen.getByRole("button", { name: /outside guest/i }));
    await user.type(screen.getByPlaceholderText(/guest's name/i), "Jane Guest");
    await user.click(screen.getByRole("button", { name: /add attendee/i }));

    // The earlier userId selection must not leak into the submitted body.
    expect(mutations.addAttendee.mutate).toHaveBeenCalledWith(
      { name: "Jane Guest", attendance: "present" },
      expect.anything(),
    );
    const [body] = mutations.addAttendee.mutate.mock.calls[0];
    expect(body).not.toHaveProperty("userId");
  });

  it("3. adding a minute item calls addMinuteItem with the entered agenda text", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting({ minuteItems: [] });

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Minute Items");
    await user.type(
      screen.getByPlaceholderText(/^agenda$/i),
      "Approve the annual budget",
    );
    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(mutations.addMinuteItem.mutate).toHaveBeenCalledWith(
      {
        agenda: "Approve the annual budget",
        discussion: undefined,
        decision: undefined,
      },
      expect.anything(),
    );
  });

  it("4. creating an action calls addAction with its description and assignee", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting();

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Actions");
    await user.type(
      screen.getByPlaceholderText(/what needs to be done/i),
      "Circulate the approved budget",
    );
    await pickOption(user, "No assignee (note only)", "Bob Assignee");
    await user.click(screen.getByRole("button", { name: /record action/i }));

    expect(mutations.addAction.mutate).toHaveBeenCalledWith(
      {
        description: "Circulate the approved budget",
        minuteItemId: undefined,
        assigneeId: "user-2",
        dueAt: undefined,
      },
      expect.anything(),
    );
  });

  it("5. an adopted meeting offers no attendee or minute-item editing controls, while a draft one does", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting({
      status: "adopted",
      adoptedAt: "2026-04-01T00:00:00.000Z",
      attendees: [
        {
          id: "att-1",
          meetingId: "meeting-1",
          userId: "user-1",
          name: null,
          attendance: "present",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const { unmount } = render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Attendees");
    expect(
      screen.queryByRole("heading", { name: /add attendee/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();

    await openTab(user, "Minute Items");
    expect(
      screen.queryByRole("heading", { name: /add agenda item/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^edit$/i }),
    ).not.toBeInTheDocument();

    unmount();

    // Same shape, but a draft meeting offers every one of those controls.
    state.meeting = makeMeeting({
      status: "draft",
      attendees: [
        {
          id: "att-1",
          meetingId: "meeting-1",
          userId: "user-1",
          name: null,
          attendance: "present",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    await openTab(user, "Attendees");
    expect(
      screen.getByRole("heading", { name: /add attendee/i }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /remove/i })).toBeVisible();

    await openTab(user, "Minute Items");
    expect(
      screen.getByRole("heading", { name: /add agenda item/i }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeVisible();
  });

  it("6. adopting calls the adopt mutation with the chosen adopting meeting's id", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting({ status: "draft" });
    state.adoptCandidates = [
      {
        id: "meeting-1",
        workspaceId: "ws-1",
        title: "Q3 Committee Meeting",
        meetingTypeId: null,
        bodyId: null,
        scheduledAt: null,
        location: null,
        confidential: false,
        status: "draft",
        adoptedAt: null,
        adoptedByMeetingId: null,
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "meeting-2",
        workspaceId: "ws-1",
        title: "Q4 Follow-up Meeting",
        meetingTypeId: null,
        bodyId: null,
        scheduledAt: null,
        location: null,
        confidential: false,
        status: "draft",
        adoptedAt: null,
        adoptedByMeetingId: null,
        createdBy: "user-1",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    // Overview is the default tab — the adopt control lives there.
    await pickOption(user, "Select adopting meeting", "Q4 Follow-up Meeting");
    await user.click(screen.getByRole("button", { name: /^adopt$/i }));

    expect(mutations.adopt.mutate).toHaveBeenCalledWith(
      "meeting-2",
      expect.anything(),
    );
  });

  it("7. a failed meeting-detail load shows a terminal error state instead of spinning forever, and offers a retry", async () => {
    const user = userEvent.setup();
    state.meeting = null;
    state.meetingIsLoading = false;
    state.meetingIsError = true;

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    // Terminal error state, not the loading spinner (finding C2: `isLoading
    // || !data` was true in both the "still loading" and "errored" cases,
    // so the dialog never stopped spinning on error).
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn't load this meeting/i,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetchMeeting).toHaveBeenCalled();
  });

  it("8. the loading state is announced to assistive tech", () => {
    state.meeting = null;
    state.meetingIsLoading = true;

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toBeVisible();
  });

  it("9. AdoptControl distinguishes a failed candidate-meetings load from a genuinely empty one", async () => {
    state.meeting = makeMeeting({ status: "draft" });
    state.adoptCandidates = [];
    state.isMeetingsError = true;

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    // Finding C3: `useMeetings` defaulted to `[]` on error, so this control
    // rendered the confident "No other meetings yet…" sentence even when the
    // underlying fetch had failed.
    expect(
      screen.queryByText(/no other meetings yet/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load other meetings/i)).toBeVisible();
  });

  it("lets the user search for the adopting meeting", async () => {
    const user = userEvent.setup();
    state.meeting = makeMeeting({ status: "draft" });
    state.adoptCandidates = [
      makeMeeting({ id: "other-1", title: "November committee meeting" }),
    ];

    render(
      <MeetingDetailDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        onClose={vi.fn()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: /search meetings/i });
    await user.type(search, "november");

    expect(search).toHaveValue("november");

    // Confirms the typed term actually reaches the hook — the mock is
    // zero-arg-shaped by default, so without capturing its call args this
    // test would stay green even if the component silently dropped the
    // search term (the exact regression this task exists to prevent).
    expect(useAdoptCandidatesMock).toHaveBeenCalledWith("ws-1", "november");

    // The candidate meeting is rendered as a Select option, which this Select
    // implementation only mounts once the trigger is opened — so open it
    // before asserting the option is there.
    const trigger = screen
      .getByText("Select adopting meeting")
      .closest('[role="combobox"]');
    if (!trigger) throw new Error("No adopting-meeting combobox found");
    await user.click(trigger);

    expect(
      await screen.findByRole("option", { name: "November committee meeting" }),
    ).toBeInTheDocument();
  });
});
