import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];
type User = { id: string; name: string; email: string };

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const JUSTIFICATION =
  "Screen cracked and motherboard failed; repair quote exceeds replacement cost.";

/**
 * An admin (owner), a custodian, a committee chair and secretary, and a
 * CEO — every non-admin granted the Assets Management page. The admin
 * configures the committee and the CEO through the real routes.
 */
async function setup(options: { configure?: boolean } = {}) {
  const admin = await createWorkspaceMember({ role: "owner" });
  const ws = admin.workspace.id;
  const people: Record<string, User> = {};
  for (const name of ["custodian", "chair", "secretary", "ceo", "acting"]) {
    const m = await createWorkspaceMember({ userName: name });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: ws,
      userId: m.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    for (const page of ["assets-management", "general-management"]) {
      await db.insert(schema.workspacePageAccessTable).values({
        workspaceId: ws,
        userId: m.user.id,
        pageSlug: page,
      });
    }
    people[name] = m.user as User;
  }
  const p = people as Record<
    "custodian" | "chair" | "secretary" | "ceo" | "acting",
    User
  >;

  const { app } = createApp();
  as(admin.user as User);

  const [asset] = await db
    .insert(schema.registeredAssetTable)
    .values({
      workspaceId: ws,
      name: "Dell Latitude 5420",
      serialNumber: "AST-DELL01",
      currentCustodianId: p.custodian.id,
    })
    .returning();
  if (!asset) throw new Error("asset fixture");

  let bodyId: string | null = null;
  if (options.configure !== false) {
    const body = await (
      await app.request(
        "/api/meeting/bodies",
        json("POST", { workspaceId: ws, name: "Jawatankuasa Pelupusan Aset" }),
      )
    ).json();
    bodyId = body.id;
    for (const [user, role] of [
      [p.chair, "chair"],
      [p.secretary, "secretary"],
    ] as const) {
      const res = await app.request(
        `/api/meeting/bodies/${body.id}/members`,
        json("POST", { workspaceId: ws, userId: user.id, role }),
      );
      expect(res.status).toBe(201);
    }
    expect(
      (
        await app.request(
          "/api/asset-registry/disposal-settings",
          json("PUT", { workspaceId: ws, committeeBodyId: body.id }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          "/api/organisation/positions/ceo",
          json("PUT", {
            workspaceId: ws,
            holderUserId: p.ceo.id,
            actingUserId: p.acting.id,
          }),
        )
      ).status,
    ).toBe(200);
  }

  return { app, ws, admin: admin.user as User, ...p, asset, bodyId };
}

function as(user: User) {
  mockAuthenticatedSession(user as never);
}

const propose = (app: App, ws: string, assetId: string, extra = {}) =>
  app.request(
    `/api/asset-registry/${assetId}/disposal-requests`,
    json("POST", {
      workspaceId: ws,
      reasonCategory: "beyond-repair",
      justification: JUSTIFICATION,
      confirmServiceable: true,
      confirmSerial: "AST-DELL01",
      ...extra,
    }),
  );

const decide = (
  app: App,
  ws: string,
  requestId: string,
  decision: "accepted" | "rejected",
  reason: string | null,
) =>
  app.request(
    `/api/pending-decision/asset-disposal/${requestId}/decide`,
    json("POST", { workspaceId: ws, decision, reason }),
  );

async function pending(app: App, ws: string) {
  const res = await app.request(`/api/pending-decision?workspaceId=${ws}`);
  const body = (await res.json()) as {
    items: Array<{
      source: string;
      id: string;
      labels?: { accept: string };
      context: string[];
    }>;
    failedSources: string[];
  };
  // A provider that throws is reported here rather than failing the list.
  expect(body.failedSources).toEqual([]);
  return body.items.filter((i) => i.source === "asset-disposal");
}

async function assetStatus(id: string) {
  const [row] = await db
    .select({ status: schema.registeredAssetTable.status })
    .from(schema.registeredAssetTable)
    .where(eq(schema.registeredAssetTable.id, id));
  return row?.status;
}

async function notificationsFor(userId: string, type: string) {
  await settleBackgroundWork();
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, type),
      ),
    );
}

describe("asset disposal approval", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("runs custodian → chair supports → CEO approves → recorded as disposed", async () => {
    const ctx = await setup();

    as(ctx.custodian);
    const res = await propose(ctx.app, ctx.ws, ctx.asset.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const request = await res.json();
    expect(await assetStatus(ctx.asset.id)).toBe("pending-disposal");
    expect(
      await notificationsFor(ctx.chair.id, "asset_disposal_review"),
    ).toHaveLength(1);

    as(ctx.chair);
    const chairItems = await pending(ctx.app, ctx.ws);
    expect(chairItems).toHaveLength(1);
    expect(chairItems[0]?.labels?.accept).toBe("Support");
    expect(chairItems[0]?.context.join(" ")).toContain(JUSTIFICATION);
    expect(
      (
        await decide(
          ctx.app,
          ctx.ws,
          request.id,
          "accepted",
          "Agreed by the committee at its October sitting.",
        )
      ).status,
    ).toBe(200);

    as(ctx.ceo);
    const ceoItems = await pending(ctx.app, ctx.ws);
    expect(ceoItems).toHaveLength(1);
    expect(ceoItems[0]?.labels?.accept).toBe("Approve disposal");
    expect(ceoItems[0]?.context.join(" ")).toContain("Agreed by the committee");
    expect(
      (await decide(ctx.app, ctx.ws, request.id, "accepted", "Approved."))
        .status,
    ).toBe(200);
    expect(await assetStatus(ctx.asset.id)).toBe("approved-for-disposal");
    expect(
      await notificationsFor(ctx.custodian.id, "asset_disposal_outcome"),
    ).toHaveLength(1);

    // Any page holder can now record the physical disposal.
    as(ctx.custodian);
    const record = await ctx.app.request(
      `/api/asset-registry/${ctx.asset.id}/disposal`,
      json("POST", {
        workspaceId: ctx.ws,
        date: "2026-10-20",
        method: "scrapped",
      }),
    );
    expect(record.status, await record.clone().text()).toBe(201);
    expect(await assetStatus(ctx.asset.id)).toBe("disposed");

    const trail = await (
      await ctx.app.request(
        `/api/asset-registry/${ctx.asset.id}/disposal-requests?workspaceId=${ctx.ws}`,
      )
    ).json();
    expect(trail[0].status).toBe("disposed");
    expect(
      trail[0].steps.map(
        (s: { outcome: string; actedAs: string }) =>
          `${s.outcome}:${s.actedAs}`,
      ),
    ).toEqual([
      "proposed:custodian",
      "supported:chair",
      "approved:ceo",
      "recorded:recorder",
    ]);
  });

  it("releases the asset and tells the custodian when the chair does not support it", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    const request = await (await propose(ctx.app, ctx.ws, ctx.asset.id)).json();

    as(ctx.chair);
    await decide(
      ctx.app,
      ctx.ws,
      request.id,
      "rejected",
      "Still serviceable after a battery swap.",
    );

    expect(await assetStatus(ctx.asset.id)).toBe("active");
    const told = await notificationsFor(
      ctx.custodian.id,
      "asset_disposal_outcome",
    );
    expect(told).toHaveLength(1);
    expect(told[0]?.content).toContain("battery swap");
    as(ctx.ceo);
    expect(await pending(ctx.app, ctx.ws)).toHaveLength(0);
  });

  it("releases the asset and tells the custodian and the chair when the CEO rejects", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    const request = await (await propose(ctx.app, ctx.ws, ctx.asset.id)).json();
    as(ctx.chair);
    await decide(ctx.app, ctx.ws, request.id, "accepted", "Supported.");
    as(ctx.ceo);
    await decide(
      ctx.app,
      ctx.ws,
      request.id,
      "rejected",
      "Redeploy it to the training room.",
    );

    expect(await assetStatus(ctx.asset.id)).toBe("active");
    expect(
      await notificationsFor(ctx.custodian.id, "asset_disposal_outcome"),
    ).toHaveLength(1);
    expect(
      await notificationsFor(ctx.chair.id, "asset_disposal_outcome"),
    ).toHaveLength(1);
  });

  it("requires a justification for every decision, support included", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    const request = await (await propose(ctx.app, ctx.ws, ctx.asset.id)).json();
    as(ctx.chair);
    expect(
      (await decide(ctx.app, ctx.ws, request.id, "accepted", null)).status,
    ).toBe(400);
    expect(
      (await decide(ctx.app, ctx.ws, request.id, "accepted", "   ")).status,
    ).toBe(400);
  });

  it("guards the proposal: justification length, the confirmations, and the serial", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    expect(
      (await propose(ctx.app, ctx.ws, ctx.asset.id, { justification: "old" }))
        .status,
    ).toBe(400);
    expect(
      (
        await propose(ctx.app, ctx.ws, ctx.asset.id, {
          confirmSerial: "AST-WRONG",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await propose(ctx.app, ctx.ws, ctx.asset.id, {
          confirmServiceable: false,
        })
      ).status,
    ).toBe(400);
    expect(await assetStatus(ctx.asset.id)).toBe("active");
  });

  it("only the custodian may propose an asset that has one; a page holder may propose one that has none", async () => {
    const ctx = await setup();
    as(ctx.chair);
    expect((await propose(ctx.app, ctx.ws, ctx.asset.id)).status).toBe(403);

    await db
      .update(schema.registeredAssetTable)
      .set({ currentCustodianId: null })
      .where(eq(schema.registeredAssetTable.id, ctx.asset.id));
    as(ctx.ceo);
    const res = await propose(ctx.app, ctx.ws, ctx.asset.id);
    expect(res.status).toBe(201);
  });

  it("routes to the secretary when the chair proposed, and to the acting CEO when the CEO proposed", async () => {
    const ctx = await setup();
    await db
      .update(schema.registeredAssetTable)
      .set({ currentCustodianId: ctx.chair.id })
      .where(eq(schema.registeredAssetTable.id, ctx.asset.id));
    as(ctx.chair);
    const request = await (await propose(ctx.app, ctx.ws, ctx.asset.id)).json();
    expect(await pending(ctx.app, ctx.ws)).toHaveLength(0);
    as(ctx.secretary);
    expect(await pending(ctx.app, ctx.ws)).toHaveLength(1);
    await decide(
      ctx.app,
      ctx.ws,
      request.id,
      "accepted",
      "Supported by the secretary in the chair's place.",
    );

    // A second asset, proposed by the CEO.
    const [asset2] = await db
      .insert(schema.registeredAssetTable)
      .values({
        workspaceId: ctx.ws,
        name: "Projector",
        serialNumber: "AST-PROJ01",
        currentCustodianId: ctx.ceo.id,
      })
      .returning();
    as(ctx.ceo);
    const req2 = await (
      await propose(ctx.app, ctx.ws, asset2!.id, {
        confirmSerial: "AST-PROJ01",
      })
    ).json();
    as(ctx.chair);
    await decide(
      ctx.app,
      ctx.ws,
      req2.id,
      "accepted",
      "Lamp unavailable for this model.",
    );
    as(ctx.ceo);
    expect((await pending(ctx.app, ctx.ws)).map((i) => i.id)).not.toContain(
      req2.id,
    );
    as(ctx.acting);
    expect((await pending(ctx.app, ctx.ws)).map((i) => i.id)).toContain(
      req2.id,
    );
  });

  it("refuses a proposal until the committee and the CEO are configured", async () => {
    const ctx = await setup({ configure: false });
    as(ctx.custodian);
    const res = await propose(ctx.app, ctx.ws, ctx.asset.id);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("not set up");
    expect(await assetStatus(ctx.asset.id)).toBe("active");
  });

  it("lets the proposer withdraw until the committee decides", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    const request = await (await propose(ctx.app, ctx.ws, ctx.asset.id)).json();
    const withdraw = await ctx.app.request(
      `/api/asset-registry/${ctx.asset.id}/disposal-requests/${request.id}/withdraw`,
      json("POST", {
        workspaceId: ctx.ws,
        justification: "Found a spare part.",
      }),
    );
    expect(withdraw.status).toBe(200);
    expect(await assetStatus(ctx.asset.id)).toBe("active");
    as(ctx.chair);
    expect(await pending(ctx.app, ctx.ws)).toHaveLength(0);
  });

  it("blocks recording a disposal without approval, except an audited admin override", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    const blocked = await ctx.app.request(
      `/api/asset-registry/${ctx.asset.id}/disposal`,
      json("POST", { workspaceId: ctx.ws, date: "2026-10-20" }),
    );
    expect(blocked.status).toBe(403);

    as(ctx.admin);
    expect(
      (
        await ctx.app.request(
          `/api/asset-registry/${ctx.asset.id}/disposal`,
          json("POST", { workspaceId: ctx.ws, date: "2026-10-20" }),
        )
      ).status,
    ).toBe(403);
    const override = await ctx.app.request(
      `/api/asset-registry/${ctx.asset.id}/disposal`,
      json("POST", {
        workspaceId: ctx.ws,
        date: "2019-03-01",
        overrideJustification:
          "Disposed in 2019 under the old paper process; recording it here.",
      }),
    );
    expect(override.status).toBe(201);
    const trail = await (
      await ctx.app.request(
        `/api/asset-registry/${ctx.asset.id}/disposal-requests?workspaceId=${ctx.ws}`,
      )
    ).json();
    expect(trail[0].steps[0]).toMatchObject({ actedAs: "override" });
  });

  it("does not let an asset be edited into or out of a disposal status", async () => {
    const ctx = await setup();
    as(ctx.custodian);
    const edit = await ctx.app.request(
      `/api/asset-registry/${ctx.asset.id}?workspaceId=${ctx.ws}`,
      json("PUT", { status: "disposed" }),
    );
    expect(edit.status).toBe(400);

    await propose(ctx.app, ctx.ws, ctx.asset.id);
    const escape = await ctx.app.request(
      `/api/asset-registry/${ctx.asset.id}?workspaceId=${ctx.ws}`,
      json("PUT", { status: "active" }),
    );
    expect(escape.status).toBe(400);
  });

  it("only global admins edit committees and office holders", async () => {
    const ctx = await setup();
    as(ctx.chair);
    expect(
      (
        await ctx.app.request(
          "/api/meeting/bodies",
          json("POST", { workspaceId: ctx.ws, name: "Rogue committee" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.app.request(
          "/api/organisation/positions/ceo",
          json("PUT", { workspaceId: ctx.ws, holderUserId: ctx.chair.id }),
        )
      ).status,
    ).toBe(403);
    // Reading is open to members.
    const positions = await (
      await ctx.app.request(`/api/organisation/positions?workspaceId=${ctx.ws}`)
    ).json();
    expect(positions[0]).toMatchObject({
      key: "ceo",
      holderUserId: ctx.ceo.id,
    });
    const members = await (
      await ctx.app.request(
        `/api/meeting/bodies/${ctx.bodyId}/members?workspaceId=${ctx.ws}`,
      )
    ).json();
    expect(
      members.map((m: { displayName: string }) => m.displayName).sort(),
    ).toEqual(["chair", "secretary"]);
  });
});
