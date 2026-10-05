import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function setup() {
  const owner = await createWorkspaceMember({ role: "owner" });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  return { app, ws: owner.workspace.id, owner: owner.user };
}

async function capture(app: App, ws: string, extra = {}) {
  return app.request(
    "/api/correspondence/letters",
    json("POST", {
      workspaceId: ws,
      direction: "in",
      type: "external",
      medium: "email",
      subject: "Permohonan kerjasama",
      senderName: "Encik Ali",
      ...extra,
    }),
  );
}

/** Registration as it leaves the row: a reference number and declaredAt. */
async function markRegistered(letterId: string, status = "registered") {
  await db
    .update(schema.letterTable)
    .set({
      refNo: "MAPIM/2026/0001",
      declaredAt: new Date(),
      status,
    })
    .where(eq(schema.letterTable.id, letterId));
}

const edit = (app: App, ws: string, id: string, body: object) =>
  app.request(
    `/api/correspondence/letters/${id}`,
    json("PUT", { workspaceId: ws, ...body }),
  );

async function lastAudit(ws: string) {
  const [event] = await db
    .select()
    .from(schema.gmAuditEventTable)
    .where(
      and(
        eq(schema.gmAuditEventTable.workspaceId, ws),
        eq(schema.gmAuditEventTable.entityType, "letter"),
      ),
    )
    .orderBy(desc(schema.gmAuditEventTable.seq))
    .limit(1);
  return event;
}

describe("correcting a registered letter", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("edits an unregistered letter freely, as before", async () => {
    const ctx = await setup();
    const letter = await (await capture(ctx.app, ctx.ws)).json();
    const res = await edit(ctx.app, ctx.ws, letter.id, {
      subject: "Permohonan kerjasama (pindaan)",
    });
    expect(res.status).toBe(200);
    expect((await lastAudit(ctx.ws))?.action).toBe("update");
  });

  it("refuses to change a registered letter without a reason", async () => {
    const ctx = await setup();
    const letter = await (await capture(ctx.app, ctx.ws)).json();
    await markRegistered(letter.id);
    const res = await edit(ctx.app, ctx.ws, letter.id, {
      senderName: "Encik Abu",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("reason");
  });

  it("corrects a registered letter with a reason, recorded in the audit trail; the reference number stays", async () => {
    const ctx = await setup();
    const letter = await (await capture(ctx.app, ctx.ws)).json();
    await markRegistered(letter.id);

    const res = await edit(ctx.app, ctx.ws, letter.id, {
      senderName: "Encik Abu",
      medium: "physical",
      correctionReason: "Sender's name was mistyped at capture",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await res.json();
    expect(after).toMatchObject({
      senderName: "Encik Abu",
      medium: "physical",
      refNo: "MAPIM/2026/0001",
      status: "registered",
    });

    const audit = await lastAudit(ctx.ws);
    expect(audit?.action).toBe("correct");
    expect(audit?.after).toMatchObject({
      senderName: "Encik Abu",
      correctionReason: "Sender's name was mistyped at capture",
    });
    expect(audit?.before).toMatchObject({ senderName: "Encik Ali" });
  });

  for (const status of ["archived", "disposed"]) {
    it(`keeps a ${status} record sealed`, async () => {
      const ctx = await setup();
      const letter = await (await capture(ctx.app, ctx.ws)).json();
      await markRegistered(letter.id, status);
      const res = await edit(ctx.app, ctx.ws, letter.id, {
        subject: "Changed",
        correctionReason: "Trying to change a sealed record",
      });
      expect(res.status).toBe(409);
    });
  }
});

describe("who may edit a letter", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  /** A workspace member with General Management access, signed in. */
  async function gmMember(ws: string) {
    const m = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: ws,
      userId: m.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await db.insert(schema.workspacePageAccessTable).values({
      workspaceId: ws,
      userId: m.user.id,
      pageSlug: "general-management",
    });
    return m.user;
  }

  it("lets the person who captured a letter edit it, and correct it once registered", async () => {
    const ctx = await setup();
    const clerk = await gmMember(ctx.ws);
    mockAuthenticatedSession(clerk);
    const letter = await (await capture(ctx.app, ctx.ws)).json();

    expect(
      (await edit(ctx.app, ctx.ws, letter.id, { senderName: "Encik Abu" }))
        .status,
    ).toBe(200);

    await markRegistered(letter.id);
    expect(
      (
        await edit(ctx.app, ctx.ws, letter.id, {
          senderName: "Encik Abu bin Bakar",
          correctionReason: "Full name per the letterhead",
        })
      ).status,
    ).toBe(200);
  });

  it("refuses another General Management user who neither captured nor holds it", async () => {
    const ctx = await setup();
    const letter = await (await capture(ctx.app, ctx.ws)).json();
    const bystander = await gmMember(ctx.ws);
    mockAuthenticatedSession(bystander);
    const res = await edit(ctx.app, ctx.ws, letter.id, { subject: "Changed" });
    expect(res.status).toBe(403);
  });

  it("lets the letter's main user and a GM admin edit it", async () => {
    const ctx = await setup();
    const holder = await gmMember(ctx.ws);
    const letter = await (await capture(ctx.app, ctx.ws)).json();
    await db
      .update(schema.letterTable)
      .set({ currentAssigneeId: holder.id })
      .where(eq(schema.letterTable.id, letter.id));

    mockAuthenticatedSession(holder);
    expect(
      (await edit(ctx.app, ctx.ws, letter.id, { subject: "By the holder" }))
        .status,
    ).toBe(200);

    mockAuthenticatedSession(ctx.owner);
    expect(
      (await edit(ctx.app, ctx.ws, letter.id, { subject: "By the admin" }))
        .status,
    ).toBe(200);
  });
});

describe("configurable letter mediums", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const mediums = (app: App, ws: string, includeInactive = false) =>
    app.request(
      `/api/correspondence/config/mediums?workspaceId=${ws}${includeInactive ? "&includeInactive=true" : ""}`,
    );

  it("accepts the built-in mediums in a workspace that has none configured", async () => {
    const ctx = await setup();
    expect((await capture(ctx.app, ctx.ws, { medium: "portal" })).status).toBe(
      201,
    );
    expect((await capture(ctx.app, ctx.ws, { medium: "fax" })).status).toBe(
      400,
    );
  });

  it("lets an admin add a medium, which letters can then use", async () => {
    const ctx = await setup();
    const res = await ctx.app.request(
      "/api/correspondence/config/mediums",
      json("POST", { workspaceId: ctx.ws, key: "whatsapp", label: "WhatsApp" }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    expect(
      (await capture(ctx.app, ctx.ws, { medium: "whatsapp" })).status,
    ).toBe(201);

    const list = await (await mediums(ctx.app, ctx.ws)).json();
    expect(list.map((m: { key: string }) => m.key)).toContain("whatsapp");
  });

  it("refuses a deactivated medium for new letters but keeps it on old ones", async () => {
    const ctx = await setup();
    const created = await (
      await ctx.app.request(
        "/api/correspondence/config/mediums",
        json("POST", { workspaceId: ctx.ws, key: "fax", label: "Fax" }),
      )
    ).json();
    const letter = await (
      await capture(ctx.app, ctx.ws, { medium: "fax" })
    ).json();

    const del = await ctx.app.request(
      `/api/correspondence/config/mediums/${created.id}?workspaceId=${ctx.ws}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);

    expect((await capture(ctx.app, ctx.ws, { medium: "fax" })).status).toBe(
      400,
    );
    // The old letter still says fax, and editing something else is fine.
    const res = await edit(ctx.app, ctx.ws, letter.id, {
      subject: "Updated",
      medium: "fax",
    });
    expect(res.status).toBe(200);
  });

  it("allows renaming a medium's label, but not the key once letters use it", async () => {
    const ctx = await setup();
    const created = await (
      await ctx.app.request(
        "/api/correspondence/config/mediums",
        json("POST", { workspaceId: ctx.ws, key: "courier", label: "Courier" }),
      )
    ).json();
    await capture(ctx.app, ctx.ws, { medium: "courier" });

    const relabel = await ctx.app.request(
      `/api/correspondence/config/mediums/${created.id}`,
      json("PUT", { workspaceId: ctx.ws, label: "Courier service" }),
    );
    expect(relabel.status).toBe(200);
    const rekey = await ctx.app.request(
      `/api/correspondence/config/mediums/${created.id}`,
      json("PUT", { workspaceId: ctx.ws, key: "dispatch" }),
    );
    expect(rekey.status).toBe(409);
  });

  it("only GM admins manage mediums", async () => {
    const ctx = await setup();
    const member = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: ctx.ws,
      userId: member.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await db.insert(schema.workspacePageAccessTable).values({
      workspaceId: ctx.ws,
      userId: member.user.id,
      pageSlug: "general-management",
    });
    mockAuthenticatedSession(member.user);
    const res = await ctx.app.request(
      "/api/correspondence/config/mediums",
      json("POST", { workspaceId: ctx.ws, key: "fax", label: "Fax" }),
    );
    expect(res.status).toBe(403);
  });
});
