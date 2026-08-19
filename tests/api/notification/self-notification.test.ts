import { afterEach, describe, expect, it, vi } from "vitest";

// The notification module reaches for the database at import time. None of
// the handlers under test query it, so an empty stand-in is enough.
vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const createNotification = vi.hoisted(() => vi.fn(async () => ({}) as unknown));

vi.mock(
  "../../../apps/api/src/notification/controllers/create-notification",
  () => ({ default: createNotification }),
);

import { publishEvent } from "../../../apps/api/src/events/index";
import "../../../apps/api/src/notification/index";

// publishEvent emits synchronously but the handlers are async, so let the
// microtask queue drain before asserting.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("notification handlers never notify the actor about their own action", () => {
  afterEach(() => {
    createNotification.mockClear();
  });

  it("skips task.created when the assignee is the person who created it", async () => {
    await publishEvent("task.created", {
      taskId: "task-1",
      userId: "user-1",
      currentUserId: "user-1",
      title: "Write the thing",
      projectId: "project-1",
    });
    await flush();

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("still notifies task.created when someone else is the assignee", async () => {
    await publishEvent("task.created", {
      taskId: "task-1",
      userId: "assignee-1",
      currentUserId: "user-1",
      title: "Write the thing",
      projectId: "project-1",
    });
    await flush();

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "assignee-1", type: "task_created" }),
    );
  });

  it("skips workspace.created when the owner is the person who created it", async () => {
    await publishEvent("workspace.created", {
      workspaceId: "workspace-1",
      workspaceName: "Operations",
      ownerEmail: "ada",
      ownerId: "user-1",
      actorId: "user-1",
    });
    await flush();

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("still notifies workspace.created when the owner is someone else", async () => {
    await publishEvent("workspace.created", {
      workspaceId: "workspace-1",
      workspaceName: "Operations",
      ownerEmail: "ada",
      ownerId: "owner-1",
      actorId: "user-1",
    });
    await flush();

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        type: "workspace_created",
      }),
    );
  });
});
