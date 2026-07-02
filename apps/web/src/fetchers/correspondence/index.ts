import { getApiUrl } from "@/fetchers/get-api-url";

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

const jsonHeaders = { "Content-Type": "application/json" };

function url(path: string) {
  return getApiUrl(`correspondence/${path}`);
}

export type ConfigItem = {
  id: string;
  active: boolean;
  createdAt?: string;
  [key: string]: unknown;
};

export type ConfigBody = Record<string, unknown>;

/** CRUD client for one `/api/correspondence/config/<resource>` endpoint. */
export function configResource(resource: string) {
  const base = `config/${resource}`;
  return {
    list: async (
      workspaceId: string,
      includeInactive = false,
    ): Promise<ConfigItem[]> =>
      jsonOrThrow(
        await fetch(
          url(
            `${base}?workspaceId=${workspaceId}${
              includeInactive ? "&includeInactive=true" : ""
            }`,
          ),
          { credentials: "include" },
        ),
      ),
    create: async (
      workspaceId: string,
      body: ConfigBody,
    ): Promise<ConfigItem> =>
      jsonOrThrow(
        await fetch(url(base), {
          method: "POST",
          credentials: "include",
          headers: jsonHeaders,
          body: JSON.stringify({ workspaceId, ...body }),
        }),
      ),
    update: async (
      workspaceId: string,
      id: string,
      body: ConfigBody,
    ): Promise<ConfigItem> =>
      jsonOrThrow(
        await fetch(url(`${base}/${id}`), {
          method: "PUT",
          credentials: "include",
          headers: jsonHeaders,
          body: JSON.stringify({ workspaceId, ...body }),
        }),
      ),
    deactivate: async (
      workspaceId: string,
      id: string,
    ): Promise<{ success: boolean }> =>
      jsonOrThrow(
        await fetch(url(`${base}/${id}?workspaceId=${workspaceId}`), {
          method: "DELETE",
          credentials: "include",
        }),
      ),
  };
}

// ── Approval chains (chain + steps) ──────────────────────────────────────────
export type ApprovalStep = {
  stepOrder: number;
  mode?: "sequential" | "parallel";
  approverType: "role" | "users";
  approverRefs: string[];
  quorum?: number;
  slaHours?: number | null;
  condition?: Record<string, unknown> | null;
};
export type ApprovalChain = ConfigItem & {
  name: string;
  appliesTo?: Record<string, unknown> | null;
  steps?: ApprovalStep[];
};

export const approvalChains = {
  list: (workspaceId: string, includeInactive = false) =>
    configResource("approval-chains").list(
      workspaceId,
      includeInactive,
    ) as Promise<ApprovalChain[]>,
  get: async (workspaceId: string, id: string): Promise<ApprovalChain> =>
    jsonOrThrow(
      await fetch(
        url(`config/approval-chains/${id}?workspaceId=${workspaceId}`),
        { credentials: "include" },
      ),
    ),
  create: (
    workspaceId: string,
    body: {
      name: string;
      appliesTo?: Record<string, unknown> | null;
      active?: boolean;
      steps?: ApprovalStep[];
    },
  ) => configResource("approval-chains").create(workspaceId, body),
  update: (
    workspaceId: string,
    id: string,
    body: {
      name?: string;
      appliesTo?: Record<string, unknown> | null;
      active?: boolean;
      steps?: ApprovalStep[];
    },
  ) => configResource("approval-chains").update(workspaceId, id, body),
  deactivate: (workspaceId: string, id: string) =>
    configResource("approval-chains").deactivate(workspaceId, id),
};

export type AuditVerifyResult = {
  ok: boolean;
  count: number;
  brokenAtSeq?: number;
};

export async function verifyAuditChain(
  workspaceId: string,
): Promise<AuditVerifyResult> {
  return jsonOrThrow(
    await fetch(url(`audit/verify?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}
