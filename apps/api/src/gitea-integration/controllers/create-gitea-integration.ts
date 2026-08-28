import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import db from "../../database";
import { integrationTable, projectTable } from "../../database/schema";
import {
  type GiteaConfig,
  getDefaultGiteaConfig,
  normalizeGiteaBaseUrl,
  validateGiteaConfig,
} from "../../plugins/gitea/config";
import {
  createGiteaClient,
  GiteaApiError,
  verifyGiteaToken,
} from "../../plugins/gitea/utils/gitea-api";

/** HTTP status codes Hono's `HTTPException` accepts for a body-carrying response. */
const CONTENTFUL_STATUS_CODES = new Set<number>([
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500,
  501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);

/**
 * `GiteaApiError#status` is a plain `number` sourced from an upstream HTTP
 * response, so it can be any value — not necessarily one of the specific
 * literals Hono's `HTTPException` accepts. Every status Gitea itself emits
 * (401/403/404/408/409/422/500/502/503/504) is in the set above and passes
 * through unchanged. For anything outside that set, a `5xx` (e.g. a 499, or
 * a Cloudflare 520-527/530 in front of a self-hosted Gitea) falls back to
 * 502 so an upstream failure is reported as an upstream failure rather than
 * misattributed to the caller; anything else falls back to 400.
 */
function toContentfulStatus(status: number): ContentfulStatusCode {
  if (CONTENTFUL_STATUS_CODES.has(status)) {
    return status as ContentfulStatusCode;
  }
  return status >= 500 ? 502 : 400;
}

async function createGiteaIntegration({
  projectId,
  baseUrl,
  accessToken,
  repositoryOwner,
  repositoryName,
}: {
  projectId: string;
  baseUrl: string;
  accessToken: string | undefined;
  repositoryOwner: string;
  repositoryName: string;
}) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  const normalizedBase = normalizeGiteaBaseUrl(baseUrl);

  const existingIntegration = await db.query.integrationTable.findFirst({
    where: and(
      eq(integrationTable.projectId, projectId),
      eq(integrationTable.type, "gitea"),
    ),
  });

  let resolvedToken = accessToken?.trim() ?? "";
  if (!resolvedToken && existingIntegration) {
    try {
      const prev = JSON.parse(existingIntegration.config) as GiteaConfig;
      resolvedToken = prev.accessToken;
    } catch (error) {
      console.warn("Failed to parse existing Gitea integration config", {
        integrationId: existingIntegration.id,
        error,
      });
    }
  }

  if (!resolvedToken) {
    throw new HTTPException(400, {
      message: "Personal access token is required",
    });
  }

  try {
    await verifyGiteaToken(normalizedBase, resolvedToken);

    const client = createGiteaClient({
      baseUrl: normalizedBase,
      accessToken: resolvedToken,
    });
    await client.getRepo(repositoryOwner, repositoryName);
  } catch (error) {
    if (error instanceof GiteaApiError) {
      throw new HTTPException(toContentfulStatus(error.status || 400), {
        message: error.message,
      });
    }
    throw error;
  }

  const allGitea = await db.query.integrationTable.findMany({
    where: eq(integrationTable.type, "gitea"),
  });

  for (const integration of allGitea) {
    if (integration.projectId === projectId) {
      continue;
    }
    if (!integration.isActive) {
      continue;
    }
    try {
      const cfg = JSON.parse(integration.config) as {
        baseUrl?: string;
        repositoryOwner?: string;
        repositoryName?: string;
      };
      if (
        normalizeGiteaBaseUrl(cfg.baseUrl ?? "") === normalizedBase &&
        cfg.repositoryOwner === repositoryOwner &&
        cfg.repositoryName === repositoryName
      ) {
        throw new HTTPException(409, {
          message: `Repository ${repositoryOwner}/${repositoryName} on this Gitea instance is already linked to another project`,
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.warn(
        "Skipping invalid Gitea integration config during conflict check",
        {
          integrationId: integration.id,
          error,
        },
      );
    }
  }

  let webhookSecret = randomBytes(24).toString("hex");
  if (existingIntegration) {
    try {
      const previousConfig = JSON.parse(
        existingIntegration.config,
      ) as GiteaConfig;
      webhookSecret = previousConfig.webhookSecret ?? webhookSecret;
    } catch (error) {
      console.warn("Failed to parse existing Gitea config for webhook secret", {
        integrationId: existingIntegration.id,
        error,
      });
    }
  }

  const config: GiteaConfig = getDefaultGiteaConfig(
    normalizedBase,
    resolvedToken,
    repositoryOwner,
    repositoryName,
    webhookSecret,
  );

  const validation = await validateGiteaConfig(config);
  if (!validation.valid) {
    throw new HTTPException(400, {
      message: validation.errors?.join(", ") ?? "Invalid config",
    });
  }

  if (existingIntegration) {
    const [updated] = await db
      .update(integrationTable)
      .set({
        config: JSON.stringify(config),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationTable.projectId, projectId),
          eq(integrationTable.type, "gitea"),
        ),
      )
      .returning();

    if (!updated) {
      throw new HTTPException(500, {
        message: "Failed to update Gitea integration",
      });
    }

    return {
      id: updated.id,
      projectId: updated.projectId,
      baseUrl: normalizedBase,
      repositoryOwner,
      repositoryName,
      webhookSecret,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  const [newIntegration] = await db
    .insert(integrationTable)
    .values({
      projectId,
      type: "gitea",
      config: JSON.stringify(config),
      isActive: true,
    })
    .returning();

  if (!newIntegration) {
    throw new HTTPException(500, {
      message: "Failed to create Gitea integration",
    });
  }

  return {
    id: newIntegration.id,
    projectId: newIntegration.projectId,
    baseUrl: normalizedBase,
    repositoryOwner,
    repositoryName,
    webhookSecret,
    isActive: newIntegration.isActive,
    createdAt: newIntegration.createdAt,
    updatedAt: newIntegration.updatedAt,
  };
}

export default createGiteaIntegration;
