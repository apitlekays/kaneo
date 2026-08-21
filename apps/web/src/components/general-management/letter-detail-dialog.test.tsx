import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Letter,
  LetterDetail,
  LetterMinute,
} from "@/fetchers/correspondence/letters";
import { MinutesSection, type Mutations } from "./letter-detail-dialog";

// MinuteThread (rendered inside MinutesSection) calls the real
// useQueryClient() to refresh the letter after a minute-update attachment
// upload, so every render here needs a real QueryClient in context — the
// mutation hook itself stays mocked above, this is unrelated to that.
function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// MinutesSection renders <MinuteThread>, which pulls in its own query
// hooks — stub them the same way minute-thread.test.tsx does, since this
// suite is about the minute list's own badges/affordances, not the thread.
vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useAddMinuteUpdate: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "officer-1", user: { name: "Officer One" } },
          { userId: "assignee-1", user: { name: "Assignee One" } },
        ],
      },
    }),
  }),
);

function makeMinute(overrides: Partial<LetterMinute> = {}): LetterMinute {
  return {
    id: "minute-1",
    letterId: "letter-1",
    authorId: "officer-1",
    body: "Please review and respond",
    actionType: null,
    assigneeId: null,
    dueAt: null,
    status: "open",
    acceptance: "accepted",
    rejectionReason: null,
    completedAt: null,
    completedBy: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updates: [],
    ...overrides,
  };
}

function makeLetter(minutes: LetterMinute[]): LetterDetail {
  const base: Letter = {
    id: "letter-1",
    workspaceId: "ws-1",
    refNo: "REF-1",
    externalRefNo: null,
    urgency: "normal",
    organisationId: null,
    fileRef: null,
    jilid: null,
    direction: "in",
    type: "external",
    medium: "email",
    subject: "Test letter",
    senderName: null,
    senderOrg: null,
    senderEmail: null,
    recipientName: null,
    recipientOrg: null,
    recipientEmail: null,
    letterDate: null,
    receivedAt: null,
    dispatchedAt: null,
    categoryId: null,
    filePlanNodeId: null,
    securityLabelId: null,
    numberSchemeId: null,
    retentionClassId: null,
    status: "in-action",
    dispositionStatus: null,
    legalHold: false,
    primaryAttachmentId: null,
    contentHash: null,
    currentAssigneeId: null,
    createdBy: null,
    declaredAt: null,
    closedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  return {
    ...base,
    attachments: [],
    minutes,
    assignments: [],
    links: [],
    approval: null,
    versions: [],
    signature: null,
    dispatches: [],
    holds: [],
    dispositions: [],
  };
}

// MinutesSection only touches `addMinute` and `completeMinute` on the
// mutations bundle, so the stub only needs to shape those two.
function makeMutations(): Mutations {
  return {
    addMinute: { mutate: vi.fn(), isPending: false },
    completeMinute: { mutate: vi.fn(), isPending: false },
  } as unknown as Mutations;
}

const userName = (id: string | null) =>
  id === "officer-1"
    ? "Officer One"
    : id === "assignee-1"
      ? "Assignee One"
      : (id ?? "—");

afterEach(cleanup);

describe("MinutesSection", () => {
  it("shows the assignee, acceptance and status badges plus the complete affordance for an open action", () => {
    const minute = makeMinute({
      assigneeId: "assignee-1",
      acceptance: "accepted",
      status: "open",
    });

    renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([minute])}
        m={makeMutations()}
        users={[
          { userId: "officer-1", user: { name: "Officer One" } },
          { userId: "assignee-1", user: { name: "Assignee One" } },
        ]}
        userName={userName}
        currentUserId="assignee-1"
        isAdmin={false}
        hasGeneralManagementAccess={false}
      />,
    );

    expect(screen.getByText("Assignee One")).toBeVisible();
    expect(screen.getByText("Open")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /mark done/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/declined/i)).not.toBeInTheDocument();
  });

  it("shows a plain note with none of the action controls", () => {
    const minute = makeMinute({ assigneeId: null, acceptance: "accepted" });

    renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([minute])}
        m={makeMutations()}
        users={[]}
        userName={userName}
        currentUserId="officer-1"
        isAdmin
        hasGeneralManagementAccess
      />,
    );

    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mark done/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/declined/i)).not.toBeInTheDocument();
  });

  it("shows the delegated-and-declined badge with its reason, and none of the now-stale assignee/status/complete controls, for a rejected minute", () => {
    // Rejection clears assigneeId server-side (see
    // tests/api-integration/minute-acceptance.test.ts), so this is the
    // shape a declined minute actually arrives in.
    const minute = makeMinute({
      assigneeId: null,
      acceptance: "rejected",
      rejectionReason: "Not my area",
      status: "open",
    });

    renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([minute])}
        m={makeMutations()}
        users={[]}
        userName={userName}
        currentUserId="officer-1"
        isAdmin
        hasGeneralManagementAccess
      />,
    );

    // The declined state is reachable and shows the reason.
    const badge = screen.getByText(/delegated, then declined/i);
    expect(badge).toBeVisible();
    expect(badge).toHaveTextContent("Not my area");

    // Controls that only mean something for a minute that still has an
    // assignee must not leak onto a declined one.
    expect(screen.queryByText("Assignee One")).not.toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting acceptance/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mark done/i }),
    ).not.toBeInTheDocument();
  });

  it("passes canPost mirroring the server rule: general-management access or being the minute's own assignee", () => {
    const forOfficer = makeMinute({
      id: "minute-officer-view",
      assigneeId: "assignee-1",
    });

    const { unmount } = renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([forOfficer])}
        m={makeMutations()}
        users={[]}
        userName={userName}
        currentUserId="someone-else"
        isAdmin={false}
        hasGeneralManagementAccess
      />,
    );
    // An officer with general-management access can post even though the
    // action is assigned to someone else.
    expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible();
    unmount();

    renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([forOfficer])}
        m={makeMutations()}
        users={[]}
        userName={userName}
        currentUserId="a-bystander"
        isAdmin={false}
        hasGeneralManagementAccess={false}
      />,
    );
    // A bystander with no page access and no assignment cannot post.
    expect(
      screen.queryByPlaceholderText(/post an update/i),
    ).not.toBeInTheDocument();
  });

  it("does not offer Mark done for a pending action, but does for an accepted one", () => {
    // The server's completeMinute route 409s while acceptance is "pending"
    // (letters.ts), so the control must not be offered before that point —
    // it would just walk the assignee into that error.
    const pending = makeMinute({
      id: "minute-pending",
      assigneeId: "assignee-1",
      acceptance: "pending",
      status: "open",
    });

    const { unmount } = renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([pending])}
        m={makeMutations()}
        users={[]}
        userName={userName}
        currentUserId="assignee-1"
        isAdmin={false}
        hasGeneralManagementAccess={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /mark done/i }),
    ).not.toBeInTheDocument();
    unmount();

    const accepted = makeMinute({
      id: "minute-accepted",
      assigneeId: "assignee-1",
      acceptance: "accepted",
      status: "open",
    });

    renderWithClient(
      <MinutesSection
        workspaceId="ws-1"
        letter={makeLetter([accepted])}
        m={makeMutations()}
        users={[]}
        userName={userName}
        currentUserId="assignee-1"
        isAdmin={false}
        hasGeneralManagementAccess={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /mark done/i }),
    ).toBeInTheDocument();
  });
});
