import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

// The route under test calls `sendCorrespondenceEmail` from `@kaneo/email`.
// The whole integration suite forces SMTP_HOST/SMTP_FROM empty (see
// tests/api-integration/setup.ts), so an unmocked call always throws
// SMTP_NOT_CONFIGURED — exactly what the "SMTP unconfigured" test below
// wants, but wrong for every other test here, which needs a "sent"
// response to assert against. Mock only `sendCorrespondenceEmail`, keeping
// every other export (types, etc.) real — same technique
// meeting-action-updates.test.ts uses for `getPrivateObject`.
const { sendCorrespondenceEmailMock } = vi.hoisted(() => ({
  sendCorrespondenceEmailMock: vi.fn(),
}));
vi.mock("@kaneo/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kaneo/email")>();
  return { ...actual, sendCorrespondenceEmail: sendCorrespondenceEmailMock };
});

type App = ReturnType<typeof createApp>["app"];

function createMeeting(
  app: App,
  body: { workspaceId: string; title: string; confidential?: boolean },
) {
  return app.request("/api/meeting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createAction(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    description: string;
    minuteItemId?: string;
    assigneeId?: string;
  },
) {
  return app.request(`/api/meeting/${meetingId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createMinuteItem(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    topic: string;
    numbering?: string;
    status?: string;
  },
) {
  return app.request(`/api/meeting/${meetingId}/minute-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getMemo(
  app: App,
  meetingId: string,
  actionId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/meeting/${meetingId}/actions/${actionId}/memo?workspaceId=${workspaceId}`,
  );
}

// biome-ignore lint/suspicious/noExplicitAny: test helper body shape mirrors the route's loose json input
function sendMemo(app: App, meetingId: string, actionId: string, body: any) {
  return app.request(`/api/meeting/${meetingId}/actions/${actionId}/memo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A General Management page holder who is deliberately NOT an attendee of
 * the meeting under test — the caller that distinguishes a real
 * `assertCanReadMeeting` check from a decorative one. Holding the page
 * satisfies "any GM page holder may send" unconditionally, so this fixture
 * only stays locked out of a confidential meeting if `assertCanReadMeeting`
 * is actually composed in the route — unlike a plain stranger, who fails
 * for a different reason and proves nothing about confidentiality. Copied
 * from the `seedGmOfficerNotAttendee` pattern in
 * meeting-action-updates.test.ts (not exported there).
 */
async function seedGmOfficerNotAttendee(workspaceId: string) {
  const gmOfficer = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: gmOfficer.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  await grantGeneralManagement(workspaceId, gmOfficer.user.id);
  return gmOfficer;
}

async function seedMeetingWithAction(options?: {
  confidential?: boolean;
  title?: string;
}) {
  const owner = await createWorkspaceMember({ role: "owner" });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();

  const meetingRes = await createMeeting(app, {
    workspaceId: owner.workspace.id,
    title: options?.title ?? "Q3 Committee Meeting",
    confidential: options?.confidential ?? false,
  });
  const meeting = await meetingRes.json();

  const actionRes = await createAction(app, meeting.id, {
    workspaceId: owner.workspace.id,
    description: "Prepare the audit response",
  });
  const action = await actionRes.json();

  return { owner, app, meeting, action };
}

/**
 * Reads the verbatim Malay greeting straight from the requirements doc
 * (section "Exact email content required" -> "Email body"), so this test
 * fails if production code ever hand-retypes, "fixes", or reflows it
 * instead of copying it exactly — the whole point of Task 10's gap-closing
 * GET route.
 */
function loadRequirementsGreeting(): string {
  const reqPath = path.resolve(
    __dirname,
    "../../docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md",
  );
  const text = fs.readFileSync(reqPath, "utf8");
  const match = text.match(/\*\*Email body:\*\*\s*\n\s*`([^`]+)`/);
  if (!match?.[1]) {
    throw new Error(
      "Could not find the 'Email body' greeting in the requirements doc",
    );
  }
  return match[1];
}

describe("meeting memorandum", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    sendCorrespondenceEmailMock.mockReset();
    sendCorrespondenceEmailMock.mockResolvedValue({ messageId: "test-msg" });
  });

  it("GET returns the default template with the Malay greeting verbatim, expressed as shortcodes", async () => {
    const raw = loadRequirementsGreeting();
    const expectedTemplate = raw
      .replace("[name of receipient]", "{{recipient_name}}")
      .replace("[name of meeting]", "{{meeting_name}}")
      .replace("[date]", "{{meeting_date}}");

    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await getMemo(app, meeting.id, action.id, owner.workspace.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultTemplate).toBe(expectedTemplate);
  });

  it("GET resolves values server-side: meeting name/date and a fallback numbering/topic/status when the action has no minute item", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction({
      title: "Special EGM",
    });

    const res = await getMemo(app, meeting.id, action.id, owner.workspace.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.values).toEqual({
      meeting_name: "Special EGM",
      meeting_date: "",
      numbering: "",
      topic: "Prepare the audit response",
      status: "open",
      recipient_name: "",
      notes: "",
    });
    expect(body.lastSend).toBeNull();
  });

  it("GET resolves numbering/topic/status from the action's minute item when it has one", async () => {
    const { owner, app, meeting } = await seedMeetingWithAction();
    const itemRes = await createMinuteItem(app, meeting.id, {
      workspaceId: owner.workspace.id,
      topic: "Budget approval",
      numbering: "3.2",
      status: "Dalam tindakan",
    });
    const item = await itemRes.json();
    const actionRes = await createAction(app, meeting.id, {
      workspaceId: owner.workspace.id,
      description: "Follow up on budget approval",
      minuteItemId: item.id,
    });
    const action = await actionRes.json();

    const res = await getMemo(app, meeting.id, action.id, owner.workspace.id);
    const body = await res.json();
    expect(body.values.numbering).toBe("3.2");
    expect(body.values.topic).toBe("Budget approval");
    expect(body.values.status).toBe("Dalam tindakan");
  });

  it("a send produces exactly one record carrying the rendered body, and the response asserts on subject/body, not just a status code", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction({
      title: "Q3 Committee Meeting",
    });

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      bodyMarkdown: "Dengan hormatnya, {{recipient_name}} diminta membalas.",
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.subject).toBe(
      "Memorandum Tindakan bagi Q3 Committee Meeting - ",
    );
    expect(created.bodyHtml).toContain("Jane Doe");
    expect(created.bodyHtml).toContain("Q3 Committee Meeting");
    expect(created.recipientEmail).toBe("jane@example.com");

    const rows = await db
      .select()
      .from(schema.meetingActionMemoTable)
      .where(eq(schema.meetingActionMemoTable.actionId, action.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bodyHtml).toBe(created.bodyHtml);
    expect(rows[0]?.subject).toBe(created.subject);
    expect(rows[0]?.recipientName).toBe("Jane Doe");

    expect(sendCorrespondenceEmailMock).toHaveBeenCalledTimes(1);

    // GET now surfaces this as the last send.
    const getRes = await getMemo(
      app,
      meeting.id,
      action.id,
      owner.workspace.id,
    );
    const getBody = await getRes.json();
    expect(getBody.lastSend?.recipientEmail).toBe("jane@example.com");
  });

  it("CC addresses reach the mail call", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      cc: ["cc1@example.com", "cc2@example.com"],
      bodyMarkdown: "Body text.",
    });
    expect(res.status).toBe(201);

    expect(sendCorrespondenceEmailMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.any(String),
      expect.any(String),
      undefined,
      expect.objectContaining({
        cc: ["cc1@example.com", "cc2@example.com"],
      }),
    );
  });

  it("replyTo defaults to governance@mapim.org when omitted", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      bodyMarkdown: "Body text.",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.replyTo).toBe("governance@mapim.org");

    expect(sendCorrespondenceEmailMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.any(String),
      expect.any(String),
      undefined,
      expect.objectContaining({ replyTo: "governance@mapim.org" }),
    );
  });

  it("honours an explicit replyTo instead of the default", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      replyTo: "chair@example.com",
      bodyMarkdown: "Body text.",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.replyTo).toBe("chair@example.com");
  });

  it("refuses a malformed recipient email", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "not-an-email",
      bodyMarkdown: "Body text.",
    });
    expect(res.status).toBe(400);
    expect(sendCorrespondenceEmailMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(schema.meetingActionMemoTable)
      .where(eq(schema.meetingActionMemoTable.actionId, action.id));
    expect(rows).toHaveLength(0);
  });

  it("surfaces SMTP misconfiguration as a clear failure, not a silent success, and writes no record", async () => {
    sendCorrespondenceEmailMock.mockRejectedValueOnce(
      new Error("SMTP_NOT_CONFIGURED"),
    );
    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      bodyMarkdown: "Body text.",
    });

    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    // A hand-thrown HTTPException returns a plain-text body, not JSON.
    const text = await res.text();
    expect(text).toContain("SMTP_NOT_CONFIGURED");

    const rows = await db
      .select()
      .from(schema.meetingActionMemoTable)
      .where(eq(schema.meetingActionMemoTable.actionId, action.id));
    expect(rows).toHaveLength(0);
  });

  it("a GM page holder who is not an attendee of a confidential meeting cannot GET or send, and the meeting's title appears in no response, subject, or stored record", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      title: "Confidential Committee Meeting",
    });
    const gmOfficer = await seedGmOfficerNotAttendee(owner.workspace.id);
    mockAuthenticatedSession(gmOfficer.user);
    const { app: officerApp } = createApp();

    const getRes = await getMemo(
      officerApp,
      meeting.id,
      action.id,
      owner.workspace.id,
    );
    expect(getRes.status).toBe(403);
    const getText = await getRes.text();
    expect(getText).not.toContain("Confidential Committee Meeting");

    const sendRes = await sendMemo(officerApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      bodyMarkdown: "Body text.",
    });
    expect(sendRes.status).toBe(403);
    const sendText = await sendRes.text();
    expect(sendText).not.toContain("Confidential Committee Meeting");

    expect(sendCorrespondenceEmailMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(schema.meetingActionMemoTable)
      .where(eq(schema.meetingActionMemoTable.actionId, action.id));
    expect(rows).toHaveLength(0);

    // Sanity-check the owner CAN read it, proving the 403s above are a
    // real confidentiality gate rather than some unrelated failure (e.g. a
    // 404 on the route). `mockAuthenticatedSession` is a global spy, not
    // scoped to an `app` instance, so the session must be switched back
    // explicitly before reusing the owner's app.
    mockAuthenticatedSession(owner.user);
    const ownerRes = await getMemo(
      app,
      meeting.id,
      action.id,
      owner.workspace.id,
    );
    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json();
    expect(ownerBody.values.meeting_name).toBe(
      "Confidential Committee Meeting",
    );
  });

  it("notes flow through to the rendered body when the template references {{notes}}", async () => {
    const { owner, app, meeting, action } = await seedMeetingWithAction();

    const res = await sendMemo(app, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      recipientName: "Jane Doe",
      recipientEmail: "jane@example.com",
      notes: "Please respond within 7 days.",
      bodyMarkdown: "Notes: {{notes}}",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.bodyHtml).toContain("Please respond within 7 days.");
  });
});
