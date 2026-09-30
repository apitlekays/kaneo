import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  resetSentNotificationEmails,
  sentNotificationEmails,
} from "./mocks/email";

async function setup() {
  const leader = await createWorkspaceMember({ role: "owner" });
  const member = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: leader.workspace.id,
    userId: member.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  const { project } = await createProjectFixture({
    workspaceId: leader.workspace.id,
    memberUserId: member.user.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "Prepare the AGM pack" })
    .returning();
  if (!task) throw new Error("task fixture");
  return {
    leader: leader.user,
    member: member.user,
    workspaceId: leader.workspace.id,
    project,
    task,
  };
}

async function notify(
  userId: string,
  type: string,
  resource: { resourceType: string; resourceId: string },
) {
  await createNotification({
    userId,
    type,
    title: `${type} title`,
    content: `${type} body`,
    ...resource,
  });
  await settleBackgroundWork();
}

const emailsTo = (address: string) =>
  sentNotificationEmails.filter((e) => e.to === address);

describe("email notifications: on by default for offers, assignments and reminders", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetSentNotificationEmails();
  });

  it("emails a member who never opened notification settings when their leader offers them a task", async () => {
    const ctx = await setup();
    mockAuthenticatedSession(ctx.leader);
    const { app } = createApp();

    const res = await app.request(`/api/task/${ctx.task.id}/assignees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: ctx.member.id }),
    });
    expect(res.status).toBe(200);
    await settleBackgroundWork();

    const sent = emailsTo(ctx.member.email);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("Prepare the AGM pack");
  });

  it("emails due-date reminders by default", async () => {
    const ctx = await setup();
    await notify(ctx.member.id, "due_date_reminder", {
      resourceType: "task",
      resourceId: ctx.task.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(1);
  });

  it("does not email anything outside offers, assignments and reminders", async () => {
    const ctx = await setup();
    for (const type of [
      "task_status_changed",
      "task_commented",
      "task_assignee_changed",
      "time_entry_created",
      "task_accepted",
    ]) {
      await notify(ctx.member.id, type, {
        resourceType: "task",
        resourceId: ctx.task.id,
      });
    }
    expect(emailsTo(ctx.member.email)).toHaveLength(0);
    // They are still in the app.
    const inApp = await db.select().from(schema.notificationTable);
    expect(inApp).toHaveLength(5);
  });

  it("respects a user who switched email off", async () => {
    const ctx = await setup();
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: ctx.member.id,
      emailEnabled: false,
    });
    await notify(ctx.member.id, "task_offered", {
      resourceType: "task",
      resourceId: ctx.task.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(0);
  });

  it("respects a paused workspace", async () => {
    const ctx = await setup();
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: ctx.member.id,
      workspaceId: ctx.workspaceId,
      isActive: false,
      emailEnabled: true,
    });
    await notify(ctx.member.id, "task_offered", {
      resourceType: "task",
      resourceId: ctx.task.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(0);
  });

  it("still filters project notifications when the workspace is narrowed to selected projects", async () => {
    const ctx = await setup();
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: ctx.member.id,
      workspaceId: ctx.workspaceId,
      isActive: true,
      emailEnabled: true,
      projectMode: "selected",
    });
    // A task outside the selection is filtered out (letters, meetings and
    // assets have no project and are not - see the resolver unit tests).
    await notify(ctx.member.id, "task_offered", {
      resourceType: "task",
      resourceId: ctx.task.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(0);
  });

  it("emails asset work-order assignments, which were previously dropped", async () => {
    const ctx = await setup();
    const [asset] = await db
      .insert(schema.registeredAssetTable)
      .values({
        workspaceId: ctx.workspaceId,
        serialNumber: "SN-1",
        name: "Generator",
      })
      .returning();
    if (!asset) throw new Error("asset fixture");

    await notify(ctx.member.id, "work_order_assigned", {
      resourceType: "asset",
      resourceId: asset.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(1);
  });

  it("emails a meeting action to someone who can read the meeting", async () => {
    const ctx = await setup();
    const [meeting] = await db
      .insert(schema.meetingTable)
      .values({ workspaceId: ctx.workspaceId, title: "Quarterly Committee" })
      .returning();
    if (!meeting) throw new Error("meeting fixture");

    await notify(ctx.member.id, "meeting_action_assigned", {
      resourceType: "meeting",
      resourceId: meeting.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(1);
  });

  it("never emails a confidential meeting's action to someone who cannot read it", async () => {
    const ctx = await setup();
    const [meeting] = await db
      .insert(schema.meetingTable)
      .values({
        workspaceId: ctx.workspaceId,
        title: "Confidential Board Matter",
        confidential: true,
      })
      .returning();
    if (!meeting) throw new Error("meeting fixture");

    await notify(ctx.member.id, "meeting_action_assigned", {
      resourceType: "meeting",
      resourceId: meeting.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(0);

    // Once they attend, it is theirs to read, and it is emailed.
    await db.insert(schema.meetingAttendeeTable).values({
      meetingId: meeting.id,
      userId: ctx.member.id,
    });
    await notify(ctx.member.id, "meeting_action_assigned", {
      resourceType: "meeting",
      resourceId: meeting.id,
    });
    expect(emailsTo(ctx.member.email)).toHaveLength(1);
  });
});
