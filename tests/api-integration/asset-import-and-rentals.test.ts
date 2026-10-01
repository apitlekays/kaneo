import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { checkAssetRemindersDue } from "../../apps/api/src/scheduler/asset-reminders";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
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
  // The owner passes the assets-management page gate.
  const owner = await createWorkspaceMember({ role: "owner" });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  return { app, owner: owner.user, workspaceId: owner.workspace.id };
}

async function addAsset(workspaceId: string, name: string, status = "active") {
  const [asset] = await db
    .insert(schema.registeredAssetTable)
    .values({
      workspaceId,
      name,
      serialNumber: `AST-${Math.random().toString(36).slice(2, 8)}`,
      status,
    })
    .returning();
  if (!asset) throw new Error("asset fixture");
  return asset;
}

async function assetNames(workspaceId: string) {
  const rows = await db
    .select({ name: schema.registeredAssetTable.name })
    .from(schema.registeredAssetTable)
    .where(eq(schema.registeredAssetTable.workspaceId, workspaceId));
  return rows.map((r) => r.name).sort();
}

const importAssets = (
  app: App,
  workspaceId: string,
  names: string[],
  dryRun?: boolean,
) =>
  app.request(
    "/api/asset-registry/import",
    json("POST", {
      workspaceId,
      dryRun,
      assets: names.map((name) => ({ name })),
    }),
  );

describe("asset import skips names that already exist", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("skips rows whose name is already registered, ignoring case and spacing", async () => {
    const ctx = await setup();
    await addAsset(ctx.workspaceId, "Dell Latitude 5420");

    const res = await importAssets(ctx.app, ctx.workspaceId, [
      "dell  latitude 5420 ",
      "Projector Epson",
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.imported).toBe(1);
    expect(body.skipped).toEqual([
      { row: 1, name: "dell  latitude 5420", reason: "exists" },
    ]);
    expect(await assetNames(ctx.workspaceId)).toEqual([
      "Dell Latitude 5420",
      "Projector Epson",
    ]);
  });

  it("imports a name repeated within the same file only once", async () => {
    const ctx = await setup();
    const body = await (
      await importAssets(ctx.app, ctx.workspaceId, ["Van", "VAN", "Lorry"])
    ).json();
    expect(body.imported).toBe(2);
    expect(body.skipped).toEqual([
      { row: 2, name: "VAN", reason: "duplicate" },
    ]);
  });

  it("a dry run reports what would happen and writes nothing", async () => {
    const ctx = await setup();
    await addAsset(ctx.workspaceId, "Generator");
    const body = await (
      await importAssets(ctx.app, ctx.workspaceId, ["Generator", "Tent"], true)
    ).json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toHaveLength(1);
    expect(await assetNames(ctx.workspaceId)).toEqual(["Generator"]);
  });

  it("only compares against the same workspace", async () => {
    const ctx = await setup();
    const other = await createWorkspaceMember({ role: "owner" });
    await addAsset(other.workspace.id, "Generator");
    const body = await (
      await importAssets(ctx.app, ctx.workspaceId, ["Generator"])
    ).json();
    expect(body.imported).toBe(1);
  });
});

describe("asset rentals to external renters", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const rentOut = (
    app: App,
    workspaceId: string,
    assetId: string,
    extra = {},
  ) =>
    app.request(
      `/api/asset-registry/${assetId}/rentals`,
      json("POST", {
        workspaceId,
        renterName: "Ahmad bin Ali",
        renterOrganisation: "Persatuan Belia Kampung",
        renterPhone: "012-3456789",
        startAt: "2026-10-01T09:00:00.000Z",
        dueAt: "2026-10-05T17:00:00.000Z",
        rate: 15000,
        ratePeriod: "day",
        deposit: 50000,
        conditionOut: "Good, minor scratch on lid",
        ...extra,
      }),
    );

  it("records a rental and shows the asset as out on rent", async () => {
    const ctx = await setup();
    const asset = await addAsset(ctx.workspaceId, "PA System");

    const res = await rentOut(ctx.app, ctx.workspaceId, asset.id);
    expect(res.status, await res.clone().text()).toBe(201);

    const list = await (
      await ctx.app.request(
        `/api/asset-registry?workspaceId=${ctx.workspaceId}`,
      )
    ).json();
    const row = list.find((a: { id: string }) => a.id === asset.id);
    expect(row.activeRental).toMatchObject({
      renterName: "Ahmad bin Ali",
      renterOrganisation: "Persatuan Belia Kampung",
    });

    const summary = await (
      await ctx.app.request(
        `/api/asset-registry/summary?workspaceId=${ctx.workspaceId}`,
      )
    ).json();
    expect(summary.onRentCount).toBe(1);
  });

  it("refuses a second rental while the asset is still out", async () => {
    const ctx = await setup();
    const asset = await addAsset(ctx.workspaceId, "PA System");
    await rentOut(ctx.app, ctx.workspaceId, asset.id);
    const second = await rentOut(ctx.app, ctx.workspaceId, asset.id, {
      renterName: "Someone else",
    });
    expect(second.status).toBe(409);
  });

  it("refuses to rent out a disposed asset, or a return date before the start", async () => {
    const ctx = await setup();
    const disposed = await addAsset(ctx.workspaceId, "Old Van", "disposed");
    expect((await rentOut(ctx.app, ctx.workspaceId, disposed.id)).status).toBe(
      400,
    );
    const asset = await addAsset(ctx.workspaceId, "Canopy");
    expect(
      (
        await rentOut(ctx.app, ctx.workspaceId, asset.id, {
          dueAt: "2026-09-01T00:00:00.000Z",
        })
      ).status,
    ).toBe(400);
  });

  it("marking it returned closes the rental, keeps it as history, and frees the asset", async () => {
    const ctx = await setup();
    const asset = await addAsset(ctx.workspaceId, "PA System");
    const rental = await (
      await rentOut(ctx.app, ctx.workspaceId, asset.id)
    ).json();

    const ret = await ctx.app.request(
      `/api/asset-registry/${asset.id}/rentals/${rental.id}/return`,
      json("POST", {
        workspaceId: ctx.workspaceId,
        returnedAt: "2026-10-06T10:00:00.000Z",
        conditionIn: "Speaker cable missing",
        depositReturned: false,
      }),
    );
    expect(ret.status).toBe(200);

    const history = await (
      await ctx.app.request(
        `/api/asset-registry/${asset.id}/rentals?workspaceId=${ctx.workspaceId}`,
      )
    ).json();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      conditionIn: "Speaker cable missing",
      depositReturned: false,
    });
    expect(history[0].returnedAt).toBeTruthy();

    // Returned twice is refused; renting out again is allowed.
    const again = await ctx.app.request(
      `/api/asset-registry/${asset.id}/rentals/${rental.id}/return`,
      json("POST", { workspaceId: ctx.workspaceId }),
    );
    expect(again.status).toBe(409);
    expect(
      (
        await rentOut(ctx.app, ctx.workspaceId, asset.id, {
          startAt: "2026-10-10T09:00:00.000Z",
          dueAt: "2026-10-11T09:00:00.000Z",
        })
      ).status,
    ).toBe(201);

    const activity = await db
      .select()
      .from(schema.assetActivityTable)
      .where(eq(schema.assetActivityTable.assetId, asset.id));
    expect(activity.map((a) => a.type)).toEqual(
      expect.arrayContaining(["rental_started", "rental_returned"]),
    );
  });

  it("accepts a return on the same day it went out, even picked as midnight", async () => {
    const ctx = await setup();
    const asset = await addAsset(ctx.workspaceId, "Canopy");
    const rental = await (
      await rentOut(ctx.app, ctx.workspaceId, asset.id, {
        startAt: "2026-10-01T14:30:00.000Z",
        dueAt: "2026-10-01T00:00:00.000Z",
      })
    ).json();
    expect(rental.id).toBeTruthy();

    const ret = await ctx.app.request(
      `/api/asset-registry/${asset.id}/rentals/${rental.id}/return`,
      json("POST", {
        workspaceId: ctx.workspaceId,
        returnedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    expect(ret.status).toBe(200);
  });

  it("reminds whoever recorded the rental, once, when it is overdue", async () => {
    const ctx = await setup();
    const asset = await addAsset(ctx.workspaceId, "PA System");
    await rentOut(ctx.app, ctx.workspaceId, asset.id, {
      startAt: "2026-01-01T09:00:00.000Z",
      dueAt: "2026-01-02T09:00:00.000Z",
    });

    await checkAssetRemindersDue();
    await checkAssetRemindersDue();
    await settleBackgroundWork();

    const notes = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "asset_rental_overdue"));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.userId).toBe(ctx.owner.id);
    expect(notes[0]?.content).toContain("Ahmad bin Ali");
  });

  it("does not let a rental be reached through another workspace's asset", async () => {
    const ctx = await setup();
    const other = await createWorkspaceMember({ role: "owner" });
    const foreign = await addAsset(other.workspace.id, "Foreign asset");
    const res = await rentOut(ctx.app, ctx.workspaceId, foreign.id);
    expect(res.status).toBe(404);
  });
});
