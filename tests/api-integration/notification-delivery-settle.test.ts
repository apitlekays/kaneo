import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  resetSentNotificationEmails,
  sentNotificationEmails,
} from "./mocks/email";

// `createNotification` inserts the notification row and returns, but kicks
// off `deliverNotification` as tracked (not awaited) background work — see
// `apps/api/src/notification/controllers/create-notification.ts`. This test
// proves that `settleBackgroundWork()` actually waits for that delivery to
// finish, by asserting on a real observable side effect (an email recorded
// by the mocked `sendNotificationEmail`) rather than a sleep.
describe("notification delivery settles via settleBackgroundWork", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetSentNotificationEmails();
  });

  it("delivers the notification by email once settleBackgroundWork resolves", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      memberUserId: user.id,
    });

    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Ship the release notes",
      })
      .returning();
    if (!task) {
      throw new Error("Failed to seed task fixture");
    }

    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: user.id,
      emailEnabled: true,
    });

    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      isActive: true,
      emailEnabled: true,
      projectMode: "all",
    });

    const notification = await createNotification({
      userId: user.id,
      type: "task_assignee_changed",
      resourceId: task.id,
      resourceType: "task",
      eventData: { taskTitle: task.title, actorName: "Someone" },
    });

    expect(notification).toBeTruthy();

    await settleBackgroundWork();

    expect(sentNotificationEmails).toHaveLength(1);
    expect(sentNotificationEmails[0]?.to).toBe(user.email);
  });
});
