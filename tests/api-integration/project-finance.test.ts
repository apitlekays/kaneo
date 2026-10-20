import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

process.env.S3_ENDPOINT ||= "http://localhost:9000";
process.env.S3_BUCKET ||= "kaneo-test-bucket";
process.env.S3_ACCESS_KEY_ID ||= "test-access-key";
process.env.S3_SECRET_ACCESS_KEY ||= "test-secret-key";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return { ...actual, deleteS3Object: vi.fn(async () => {}) };
});

type App = ReturnType<typeof createApp>["app"];
type User = typeof schema.userTable.$inferSelect;
type Details = {
  description: string | null;
  budget: number | null;
  revenue: number | null;
  expenditure: number;
  canEdit: boolean;
};
type CostList = {
  canAdd: boolean;
  items: { id: string; amount: number; canEdit: boolean }[];
};

function as(user: User): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function addStaff(workspaceId: string, name: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, email: `${id}@example.com`, emailVerified: true, name })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role: "member",
    joinedAt: new Date(),
  });
  return user;
}

const details = async (app: App, projectId: string) =>
  (await (
    await app.request(`/api/project-details/${projectId}`)
  ).json()) as Details;

const addCost = (
  app: App,
  taskId: string,
  amount: number,
  description = "Courier",
) =>
  app.request(
    `/api/task-cost/task/${taskId}`,
    json("POST", { description, amount, incurredOn: "2026-10-20" }),
  );

async function createTask(app: App, projectId: string, title = "Site visit") {
  const res = await app.request(
    `/api/task/${projectId}`,
    json("POST", {
      title,
      description: "",
      priority: "no-priority",
      status: "to-do",
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

describe("API integration: project details and costs", () => {
  let admin: User;
  let creator: User;
  let consultant: User;
  let other: User;
  let workspaceId: string;
  let projectId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await createWorkspaceMember({ role: "owner" });
    admin = seeded.user;
    workspaceId = seeded.workspace.id;
    creator = await addStaff(workspaceId, "Creator");
    consultant = await addStaff(workspaceId, "Consultant");
    other = await addStaff(workspaceId, "Other");

    // Only global admins create projects; record a staff member as this
    // one's creator (and so its first manager), as if handed over.
    const res = await as(admin).request(
      "/api/project",
      json("POST", { workspaceId, name: "Audit", icon: "Layout", slug: "AUD" }),
    );
    expect(res.status).toBe(200);
    projectId = ((await res.json()) as { id: string }).id;
    await db
      .update(schema.projectTable)
      .set({ createdBy: creator.id })
      .where(eq(schema.projectTable.id, projectId));
    await db
      .insert(schema.projectMemberTable)
      .values({ projectId, userId: creator.id, role: "manager" });
    for (const user of [consultant, other])
      await db
        .insert(schema.projectMemberTable)
        .values({ projectId, userId: user.id, role: "member" });
  });

  it("lets the creator, a manager and a global admin edit the ribbon, nobody else", async () => {
    const put = (user: User, body: unknown) =>
      as(user).request(`/api/project-details/${projectId}`, json("PUT", body));

    expect((await put(consultant, { budget: 100_00 })).status).toBe(403);
    expect((await details(as(consultant), projectId)).canEdit).toBe(false);

    expect(
      (await put(creator, { description: "Year-end audit", budget: 5_000_00 }))
        .status,
    ).toBe(200);
    expect((await put(admin, { revenue: 8_000_00 })).status).toBe(200);

    // A creator demoted to member still runs the project...
    await db
      .update(schema.projectMemberTable)
      .set({ role: "member" })
      .where(eq(schema.projectMemberTable.userId, creator.id));
    expect((await put(creator, { budget: 6_000_00 })).status).toBe(200);

    // ...and a manager the creator appoints can edit too.
    expect(
      (
        await as(creator).request(
          `/api/project-member/${projectId}`,
          json("POST", { userId: consultant.id, role: "manager" }),
        )
      ).status,
    ).toBe(200);
    expect((await put(consultant, { revenue: 9_000_00 })).status).toBe(200);

    const d = await details(as(other), projectId);
    expect(d).toMatchObject({
      description: "Year-end audit",
      budget: 6_000_00,
      revenue: 9_000_00,
      expenditure: 0,
      canEdit: false,
    });
  });

  it("tallies expenditure from every task and subtask, once each", async () => {
    const parent = await createTask(as(creator), projectId, "Fieldwork");
    const child = await createTask(as(creator), projectId, "Stock count");
    await as(creator).request(
      "/api/task-relation",
      json("POST", {
        sourceTaskId: parent,
        targetTaskId: child,
        relationType: "subtask",
      }),
    );
    expect((await addCost(as(consultant), parent, 120_50)).status).toBe(201);
    expect((await addCost(as(other), child, 79_50)).status).toBe(201);
    expect((await details(as(other), projectId)).expenditure).toBe(200_00);

    // Positive amounts only.
    expect((await addCost(as(other), child, 0)).status).toBe(400);
    expect((await addCost(as(other), child, -5_00)).status).toBe(400);

    // Deleting a task takes its costs with it.
    await as(creator).request(`/api/task/${child}`, { method: "DELETE" });
    expect((await details(as(other), projectId)).expenditure).toBe(120_50);
  });

  it("lets people change their own entries; runners change anyone's", async () => {
    const task = await createTask(as(creator), projectId);
    const created = (await (
      await addCost(as(consultant), task, 50_00)
    ).json()) as {
      id: string;
    };
    const url = `/api/task-cost/task/${task}/${created.id}`;

    const othersView = (await (
      await as(other).request(`/api/task-cost/task/${task}`)
    ).json()) as CostList;
    expect(othersView.canAdd).toBe(true);
    expect(othersView.items[0]?.canEdit).toBe(false);
    expect(
      (await as(other).request(url, json("PUT", { amount: 1 }))).status,
    ).toBe(403);
    expect((await as(other).request(url, { method: "DELETE" })).status).toBe(
      403,
    );

    expect(
      (await as(consultant).request(url, json("PUT", { amount: 60_00 })))
        .status,
    ).toBe(200);
    expect((await details(as(other), projectId)).expenditure).toBe(60_00);

    expect((await as(creator).request(url, { method: "DELETE" })).status).toBe(
      200,
    );
    expect((await details(as(other), projectId)).expenditure).toBe(0);
  });

  it("keeps costs and figures from people outside the project", async () => {
    const outsider = await addStaff(workspaceId, "Outsider");
    const task = await createTask(as(creator), projectId);
    expect(
      (await as(outsider).request(`/api/project-details/${projectId}`)).status,
    ).toBe(403);
    expect(
      (await as(outsider).request(`/api/task-cost/task/${task}`)).status,
    ).toBe(403);
    expect((await addCost(as(outsider), task, 10_00)).status).toBe(403);
  });

  it("accepts a receipt only from the task's own upload folder", async () => {
    const task = await createTask(as(creator), projectId);
    const presign = await as(consultant).request(
      `/api/task-cost/task/${task}/receipt/presign`,
      json("POST", {
        filename: "courier.pdf",
        mimeType: "application/pdf",
        size: 2048,
      }),
    );
    expect(presign.status).toBe(200);
    const { key } = (await presign.json()) as { key: string };
    expect(key).toContain(`/task-cost/${task}/`);

    const withReceipt = (objectKey: string) =>
      as(consultant).request(
        `/api/task-cost/task/${task}`,
        json("POST", {
          description: "Courier",
          amount: 25_00,
          incurredOn: "2026-10-20",
          receipt: {
            objectKey,
            filename: "courier.pdf",
            mimeType: "application/pdf",
            size: 2048,
          },
        }),
      );
    expect(
      (
        await withReceipt(
          key.replace(`/task-cost/${task}/`, "/task-cost/other/"),
        )
      ).status,
    ).toBe(400);
    expect((await withReceipt(key)).status).toBe(201);

    const list = (await (
      await as(other).request(`/api/task-cost/task/${task}`)
    ).json()) as { items: { receiptFilename: string | null }[] };
    expect(list.items[0]?.receiptFilename).toBe("courier.pdf");
  });
});
