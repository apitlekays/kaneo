import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "../../apps/api/src/auth";
import {
  DEFAULT_GM_CATEGORIES,
  seedDefaultCategories,
} from "../../apps/api/src/correspondence/default-categories";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

type App = ReturnType<typeof createApp>["app"];
type CategoryRow = { id: string; key: string; label: string };
type User = typeof schema.userTable.$inferSelect;

/**
 * Drive REAL workspace creation through Better Auth's organization plugin,
 * the only path that fires `afterCreateOrganization` in `auth.ts` (the hook
 * this feature is seeded from). `createWorkspaceMember` in
 * `helpers/fixtures.ts` inserts the `workspace` row directly and does NOT
 * go through this plugin, so it would never exercise the seeding hook —
 * that fixture is deliberately not used here.
 *
 * Calling `auth.api.createOrganization` directly with an explicit `userId`
 * and no request/session is the same "system action" path
 * `utils/migrate-organizations.ts` already uses; better-auth's org route
 * treats it as a server-side call and still runs every configured
 * `organizationHooks`, including `afterCreateOrganization`.
 */
async function createWorkspaceViaOrganizationHook(
  name = "Seed Categories Co",
): Promise<{ user: User; workspaceId: string }> {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Workspace Creator",
    })
    .returning();
  if (!user) throw new Error("failed to seed user");

  const organization = await auth.api.createOrganization({
    body: {
      name,
      slug: `ws-${randomUUID()}`,
      userId: user.id,
    },
  });
  if (!organization) throw new Error("createOrganization returned nothing");

  return { user, workspaceId: organization.id };
}

function appAs(user: User): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

async function listCategories(app: App, workspaceId: string) {
  const res = await app.request(
    `/api/correspondence/config/categories?workspaceId=${workspaceId}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as CategoryRow[];
}

describe("default Correspondence categories are seeded on workspace creation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("seeds all ten defaults with the exact keys and labels, in the intended order", async () => {
    const { user, workspaceId } = await createWorkspaceViaOrganizationHook();
    const app = appAs(user);

    const categories = await listCategories(app, workspaceId);

    // Asserting the array (not a Set) is exactly what would fail if every
    // seeded row shared one `createdAt` — the list route orders by
    // `asc(createdAt)`, and with a shared timestamp Postgres is free to
    // return ties in any order.
    expect(categories.map((c) => ({ key: c.key, label: c.label }))).toEqual(
      DEFAULT_GM_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
    );
  });

  it("records a create audit event for each seeded category, attributed to the workspace creator", async () => {
    const { user, workspaceId } = await createWorkspaceViaOrganizationHook();

    const categories = await db
      .select()
      .from(schema.gmCategoryTable)
      .where(eq(schema.gmCategoryTable.workspaceId, workspaceId));
    expect(categories).toHaveLength(DEFAULT_GM_CATEGORIES.length);

    const events = await db
      .select()
      .from(schema.gmAuditEventTable)
      .where(eq(schema.gmAuditEventTable.workspaceId, workspaceId))
      .orderBy(asc(schema.gmAuditEventTable.seq));

    const categoryEvents = events.filter(
      (event) => event.entityType === "gm_category",
    );
    expect(categoryEvents).toHaveLength(DEFAULT_GM_CATEGORIES.length);

    const seededIds = new Set(categories.map((c) => c.id));
    for (const event of categoryEvents) {
      expect(event.action).toBe("create");
      expect(event.actorId).toBe(user.id);
      expect(seededIds.has(event.entityId)).toBe(true);
    }
  });

  it("is idempotent: seeding an already-seeded workspace creates no duplicates, no extra audit events, and does not throw", async () => {
    const { user, workspaceId } = await createWorkspaceViaOrganizationHook();

    // Re-run the seeding function directly against the same workspace,
    // rather than creating a second organization, to prove the function
    // itself tolerates being called again on top of its own rows.
    await expect(
      db.transaction((tx) => seedDefaultCategories(tx, workspaceId, user.id)),
    ).resolves.not.toThrow();

    const categories = await db
      .select()
      .from(schema.gmCategoryTable)
      .where(eq(schema.gmCategoryTable.workspaceId, workspaceId));
    expect(categories).toHaveLength(DEFAULT_GM_CATEGORIES.length);
    expect(new Set(categories.map((c) => c.key)).size).toBe(
      DEFAULT_GM_CATEGORIES.length,
    );

    const events = await db
      .select()
      .from(schema.gmAuditEventTable)
      .where(eq(schema.gmAuditEventTable.workspaceId, workspaceId));
    const categoryEvents = events.filter(
      (event) => event.entityType === "gm_category",
    );
    expect(categoryEvents).toHaveLength(DEFAULT_GM_CATEGORIES.length);
  });

  it("does not seed categories into an unrelated workspace", async () => {
    const { workspaceId: firstWorkspaceId } =
      await createWorkspaceViaOrganizationHook("First Co");
    const { workspaceId: secondWorkspaceId } =
      await createWorkspaceViaOrganizationHook("Second Co");

    const firstCategories = await db
      .select()
      .from(schema.gmCategoryTable)
      .where(eq(schema.gmCategoryTable.workspaceId, firstWorkspaceId));
    const secondCategories = await db
      .select()
      .from(schema.gmCategoryTable)
      .where(eq(schema.gmCategoryTable.workspaceId, secondWorkspaceId));

    expect(firstCategories).toHaveLength(DEFAULT_GM_CATEGORIES.length);
    expect(secondCategories).toHaveLength(DEFAULT_GM_CATEGORIES.length);
    const firstIds = new Set(firstCategories.map((c) => c.id));
    for (const category of secondCategories) {
      expect(firstIds.has(category.id)).toBe(false);
    }
  });
});
