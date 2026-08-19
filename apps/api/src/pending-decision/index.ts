import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { collectPendingDecisions } from "./collect";
import { providers } from "./registry";
import type { PendingDecisionProvider } from "./types";

type Env = { Variables: { userId: string; workspaceId?: string } };

export function resolveProvider(
  registry: PendingDecisionProvider[],
  source: string,
): PendingDecisionProvider {
  const provider = registry.find((p) => p.source === source);
  if (!provider)
    throw new HTTPException(404, {
      message: `Unknown pending-decision source: ${source}`,
    });
  return provider;
}

function getIp(c: { req: { header(name: string): string | undefined } }) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    null
  );
}

const pendingDecision = new Hono<Env>()
  .get(
    "/",
    describeRoute({
      operationId: "listPendingDecisions",
      tags: ["Pending decisions"],
      description: "Work awaiting the current user's accept or reject",
    }),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId") as string;
      const userId = c.get("userId") as string;
      const { items, failedSources } = await collectPendingDecisions(
        providers,
        userId,
        workspaceId,
      );
      return c.json({ items, failedSources });
    },
  )
  .post(
    "/:source/:id/decide",
    describeRoute({
      operationId: "decidePendingDecision",
      tags: ["Pending decisions"],
      description: "Accept or reject one item of pending work",
    }),
    validator("param", v.object({ source: v.string(), id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        decision: v.picklist(["accepted", "rejected"]),
        reason: v.nullable(v.string()),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    async (c) => {
      const { source, id } = c.req.valid("param");
      const { decision, reason } = c.req.valid("json");
      const provider = resolveProvider(providers, source);
      await provider.decide({
        userId: c.get("userId") as string,
        workspaceId: c.get("workspaceId") as string,
        id,
        decision,
        reason: reason?.trim() || null,
        ip: getIp(c),
      });
      return c.json({ ok: true });
    },
  );

export default pendingDecision;
