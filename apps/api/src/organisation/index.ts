import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  userTable,
  workspacePositionTable,
  workspaceUserTable,
} from "../database/schema";
import { isGlobalAdmin } from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";

/**
 * The offices approval flows route to. Fixed in code because each one is
 * referenced by a flow ("the CEO approves a disposal"); the holder is data.
 */
export const POSITIONS = [
  { key: "ceo", label: "Chief Executive Officer" },
] as const;
export type PositionKey = (typeof POSITIONS)[number]["key"];

const actingUser = alias(userTable, "acting_user");

export async function listPositions(workspaceId: string) {
  const rows = await db
    .select({
      position: workspacePositionTable,
      holderName: userTable.name,
      holderImage: userTable.image,
      actingName: actingUser.name,
      actingImage: actingUser.image,
    })
    .from(workspacePositionTable)
    .leftJoin(userTable, eq(workspacePositionTable.holderUserId, userTable.id))
    .leftJoin(
      actingUser,
      eq(workspacePositionTable.actingUserId, actingUser.id),
    )
    .where(eq(workspacePositionTable.workspaceId, workspaceId));
  const byKey = new Map(rows.map((r) => [r.position.key, r]));

  // Every known office is listed, configured or not, so the UI can show
  // an empty slot to fill.
  return POSITIONS.map(({ key, label }) => {
    const row = byKey.get(key);
    return {
      key,
      label: row?.position.label ?? label,
      holderUserId: row?.position.holderUserId ?? null,
      holderName: row?.holderName ?? null,
      holderImage: row?.holderImage ?? null,
      actingUserId: row?.position.actingUserId ?? null,
      actingName: row?.actingName ?? null,
      actingImage: row?.actingImage ?? null,
    };
  });
}

/** Who holds an office (and who acts for them), or nulls when unset. */
export async function resolvePosition(workspaceId: string, key: PositionKey) {
  const [row] = await db
    .select({
      holderUserId: workspacePositionTable.holderUserId,
      actingUserId: workspacePositionTable.actingUserId,
      label: workspacePositionTable.label,
    })
    .from(workspacePositionTable)
    .where(
      and(
        eq(workspacePositionTable.workspaceId, workspaceId),
        eq(workspacePositionTable.key, key),
      ),
    )
    .limit(1);
  return {
    holderUserId: row?.holderUserId ?? null,
    actingUserId: row?.actingUserId ?? null,
  };
}

async function assertMember(workspaceId: string, userId: string) {
  const [member] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new HTTPException(400, {
      message: "That person is not a member of this workspace",
    });
  }
}

const positionKeys = POSITIONS.map((p) => p.key) as [PositionKey];

const organisation = new Hono<{
  Variables: { userId: string; workspaceId: string };
}>()
  .get(
    "/positions",
    describeRoute({
      operationId: "listPositions",
      tags: ["Organisation"],
      description: "List the workspace's offices and who holds them",
    }),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => c.json(await listPositions(c.get("workspaceId"))),
  )
  .put(
    "/positions/:key",
    describeRoute({
      operationId: "setPosition",
      tags: ["Organisation"],
      description:
        "Set who holds an office, and who acts for them (global admin only)",
    }),
    validator("param", v.object({ key: v.picklist(positionKeys) })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        holderUserId: v.nullable(v.string()),
        actingUserId: v.optional(v.nullable(v.string())),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      if (!(await isGlobalAdmin(c.get("userId"), workspaceId))) {
        throw new HTTPException(403, {
          message: "Only global admins can change office holders",
        });
      }
      const { key } = c.req.valid("param");
      const { holderUserId, actingUserId } = c.req.valid("json");
      if (holderUserId) await assertMember(workspaceId, holderUserId);
      if (actingUserId) await assertMember(workspaceId, actingUserId);
      if (holderUserId && actingUserId && holderUserId === actingUserId) {
        throw new HTTPException(400, {
          message: "The acting holder must be someone other than the holder",
        });
      }

      const label = POSITIONS.find((p) => p.key === key)?.label ?? key;
      await db
        .insert(workspacePositionTable)
        .values({
          workspaceId,
          key,
          label,
          holderUserId,
          actingUserId: actingUserId ?? null,
        })
        .onConflictDoUpdate({
          target: [
            workspacePositionTable.workspaceId,
            workspacePositionTable.key,
          ],
          set: {
            holderUserId,
            ...(actingUserId !== undefined ? { actingUserId } : {}),
            updatedAt: new Date(),
          },
        });
      return c.json(await listPositions(workspaceId));
    },
  );

export default organisation;
