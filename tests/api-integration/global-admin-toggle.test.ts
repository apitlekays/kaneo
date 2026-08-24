import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ACCESS_PAGE_SLUGS } from "../../apps/api/src/workspace-access";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

async function addMember(
  workspaceId: string,
  userId: string,
  role: string,
  previousRole: string | null = null,
) {
  const [row] = await db
    .insert(schema.workspaceUserTable)
    .values({
      workspaceId,
      userId,
      role,
      previousRole,
      joinedAt: new Date(),
    })
    .returning();
  return row;
}

function toggleGlobalAdmin(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  userId: string,
  enabled: boolean,
) {
  return app.request(`/api/workspace-access/${workspaceId}/global-admin`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, enabled }),
  });
}

describe("API integration: global admin promote/demote", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("promotes a manager to global-admin, remembering their prior role", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const member = (
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspaceId))
    ).find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("global-admin");
    expect(member?.previousRole).toBe("manager");
  });

  it("demotes a promoted member back to their remembered role", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "global-admin", "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      false,
    );
    expect(response.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("manager");
    expect(member?.previousRole).toBeNull();
  });

  it("falls back to member when promoting/demoting a member with no previousRole", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "member");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    await toggleGlobalAdmin(app, workspaceId, target.user.id, true);
    await toggleGlobalAdmin(app, workspaceId, target.user.id, false);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("member");
    expect(member?.previousRole).toBeNull();
  });

  it("does not clobber previousRole when promoting an already-promoted member twice", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    await toggleGlobalAdmin(app, workspaceId, target.user.id, true);
    // Second promotion is a no-op: must not overwrite previousRole with
    // "global-admin".
    const second = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(second.status).toBe(200);

    let rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    let member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("global-admin");
    expect(member?.previousRole).toBe("manager");

    await toggleGlobalAdmin(app, workspaceId, target.user.id, false);
    rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("manager");
    expect(member?.previousRole).toBeNull();
  });

  it("refuses to change the workspace owner's role", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const workspaceId = owner.workspace.id;
    const admin = await createWorkspaceMember();
    await addMember(workspaceId, admin.user.id, "global-admin");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      owner.user.id,
      true,
    );
    expect(response.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const ownerRow = rows.find((m) => m.userId === owner.user.id);
    expect(ownerRow?.role).toBe("owner");
    expect(ownerRow?.previousRole).toBeNull();
  });

  it("refuses a non-admin actor and changes nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const workspaceId = owner.workspace.id;
    const actor = await createWorkspaceMember();
    await addMember(workspaceId, actor.user.id, "member");
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(response.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const targetRow = rows.find((m) => m.userId === target.user.id);
    expect(targetRow?.role).toBe("manager");
    expect(targetRow?.previousRole).toBeNull();
  });

  it("404s when the target user is not a member of the workspace", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      outsider.user.id,
      true,
    );
    expect(response.status).toBe(404);
  });

  it("grants every access page slug to a promoted member without matrix rows", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const promote = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(promote.status).toBe(200);

    // No explicit matrix grant exists for this member at all.
    const grants = await db
      .select()
      .from(schema.workspacePageAccessTable)
      .where(eq(schema.workspacePageAccessTable.userId, target.user.id));
    expect(grants).toHaveLength(0);

    mockAuthenticatedSession(target.user);
    const meResponse = await app.request(
      `/api/workspace-access/${workspaceId}/me`,
    );
    expect(meResponse.status).toBe(200);
    const body = await meResponse.json();
    expect(body.isAdmin).toBe(true);
    for (const slug of ACCESS_PAGE_SLUGS) {
      expect(body.pages).toContain(slug);
    }
  });

  it("lets a general-management page holder who is not global admin read the config reference data their UI actually calls, but blocks approval-chains and summary", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "member");
    await grantGeneralManagement(workspaceId, target.user.id);

    mockAuthenticatedSession(target.user);
    const { app } = createApp();

    // GET /config/* is reference data (organisations, categories, security
    // labels, distribution lists, retention classes) read by the register
    // and by the capture/detail dialogs' pickers — every GM page holder
    // needs it, not just admins.
    for (const path of ["categories", "organisations", "security-labels"]) {
      const response = await app.request(
        `/api/correspondence/config/${path}?workspaceId=${workspaceId}`,
      );
      expect(response.status).toBe(200);
    }

    // Approval chains expose approverRefs/quorum/condition and are read by
    // exactly one component, used only in Settings — admin-only.
    const approvalChainsResponse = await app.request(
      `/api/correspondence/config/approval-chains?workspaceId=${workspaceId}`,
    );
    expect(approvalChainsResponse.status).toBe(403);

    // The Overview dashboard is admin-only, so its summary data is too.
    const summaryResponse = await app.request(
      `/api/correspondence/summary?workspaceId=${workspaceId}`,
    );
    expect(summaryResponse.status).toBe(403);
  });

  it("still lets that same general-management page holder list the letters register — the letter-work regression guard", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "member");
    await grantGeneralManagement(workspaceId, target.user.id);

    mockAuthenticatedSession(target.user);
    const { app } = createApp();

    const registerResponse = await app.request(
      `/api/correspondence/letters?workspaceId=${workspaceId}`,
    );
    expect(registerResponse.status).toBe(200);
  });

  it("lets that same member through the previously-403 approval-chains and summary routes once promoted to global admin", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "member");
    await grantGeneralManagement(workspaceId, target.user.id);

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const promote = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(promote.status).toBe(200);

    mockAuthenticatedSession(target.user);

    const configResponse = await app.request(
      `/api/correspondence/config/categories?workspaceId=${workspaceId}`,
    );
    expect(configResponse.status).toBe(200);

    const approvalChainsResponse = await app.request(
      `/api/correspondence/config/approval-chains?workspaceId=${workspaceId}`,
    );
    expect(approvalChainsResponse.status).toBe(200);

    const summaryResponse = await app.request(
      `/api/correspondence/summary?workspaceId=${workspaceId}`,
    );
    expect(summaryResponse.status).toBe(200);
  });

  describe("lost-race response (409, not a false success)", () => {
    // The route reads the member row, then guards its UPDATE with
    // `eq(role, member.role)` so a concurrent write can't be clobbered by a
    // stale write. Previously a lost race still returned `{ success: true }`
    // because a zero-row UPDATE was never distinguished from a real one.
    //
    // To simulate "someone else changes the role between the read and the
    // write" against the *live* route (no route changes, no fake DB), we
    // hook the one seam Drizzle exposes for this: every `db.update(table)`
    // call shares `PgUpdateBuilder.prototype.set`, and the `PgUpdateBase`
    // instance it returns owns its own `execute` (an instance property, not
    // a shared one). We patch that single instance -- scoped to this exact
    // table via `this.table`, restored in `finally` -- so that the instant
    // before the route's conditional UPDATE reaches Postgres, a real
    // concurrent UPDATE lands first and moves the row out from under its
    // `eq(role, member.role)` predicate. This is more deterministic than
    // racing two real HTTP calls against each other (which can just as
    // easily fully serialize and never exercise the 0-row branch at all),
    // while still exercising the actual route handler end-to-end.
    it("returns 409 and leaves the row exactly as the concurrent writer left it", async () => {
      const admin = await createWorkspaceMember({ role: "global-admin" });
      const workspaceId = admin.workspace.id;
      const target = await createWorkspaceMember();
      const targetRow = await addMember(workspaceId, target.user.id, "manager");

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const probe = db.update(schema.workspaceUserTable);
      const proto = Object.getPrototypeOf(probe) as {
        set: (this: { table: unknown }, values: unknown) => {
          table: unknown;
          execute: (...args: unknown[]) => unknown;
        };
      };
      const originalSet = proto.set;
      let intercepted = false;
      const setSpy = vi
        .spyOn(proto, "set")
        .mockImplementation(function (
          this: { table: unknown },
          values: unknown,
        ) {
          const built = originalSet.call(this, values);
          if (!intercepted && this.table === schema.workspaceUserTable) {
            intercepted = true;
            const originalExecute = built.execute.bind(built);
            built.execute = async (...args: unknown[]) => {
              // The concurrent write that wins the race: some other actor
              // demotes this member back to "member" (and clears
              // previousRole) between this route's read and its write.
              await db
                .update(schema.workspaceUserTable)
                .set({ role: "member", previousRole: null })
                .where(eq(schema.workspaceUserTable.id, targetRow.id));
              return originalExecute(...args);
            };
          }
          return built;
        });

      let response: Response;
      try {
        response = await toggleGlobalAdmin(
          app,
          workspaceId,
          target.user.id,
          true,
        );
      } finally {
        setSpy.mockRestore();
      }

      expect(response.status).toBe(409);

      const rows = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
      const member = rows.find((m) => m.userId === target.user.id);
      // The stale promotion must not have landed on top of the concurrent
      // write -- the row reflects only what the "other caller" wrote.
      expect(member?.role).toBe("member");
      expect(member?.previousRole).toBeNull();
    });
  });

  describe("genuine no-ops still succeed (409 must not swallow idempotency)", () => {
    it("returns success, not 409, when promoting an already-promoted member", async () => {
      const admin = await createWorkspaceMember({ role: "global-admin" });
      const workspaceId = admin.workspace.id;
      const target = await createWorkspaceMember();
      await addMember(workspaceId, target.user.id, "global-admin", "manager");

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await toggleGlobalAdmin(
        app,
        workspaceId,
        target.user.id,
        true,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });

      const rows = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
      const member = rows.find((m) => m.userId === target.user.id);
      expect(member?.role).toBe("global-admin");
      expect(member?.previousRole).toBe("manager");
    });

    it("returns success, not 409, when demoting a member who is not a global admin", async () => {
      const admin = await createWorkspaceMember({ role: "global-admin" });
      const workspaceId = admin.workspace.id;
      const target = await createWorkspaceMember();
      await addMember(workspaceId, target.user.id, "manager");

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await toggleGlobalAdmin(
        app,
        workspaceId,
        target.user.id,
        false,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });

      const rows = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
      const member = rows.find((m) => m.userId === target.user.id);
      expect(member?.role).toBe("manager");
      expect(member?.previousRole).toBeNull();
    });
  });
});
