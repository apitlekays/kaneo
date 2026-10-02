import { getApiUrl } from "@/fetchers/get-api-url";

// Committees are the Meeting Minutes module's "bodies" (`meeting_body`);
// office holders are `workspace_position`. Both feed approval flows such as
// asset disposal. Reads are open to page holders; writes are global admin.

export type Committee = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  quorumRule: string | null;
  active: boolean;
  createdAt: string;
};

export type CommitteeRole = "chair" | "secretary" | "member";

export type CommitteeMember = {
  id: string;
  bodyId: string;
  userId: string | null;
  name: string | null;
  displayName: string | null;
  userEmail: string | null;
  userImage: string | null;
  role: CommitteeRole;
  active: boolean;
};

export type OfficeHolder = {
  key: "ceo";
  label: string;
  holderUserId: string | null;
  holderName: string | null;
  holderImage: string | null;
  actingUserId: string | null;
  actingName: string | null;
  actingImage: string | null;
};

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listCommittees(
  workspaceId: string,
  includeInactive = true,
): Promise<Committee[]> {
  return jsonOrThrow(
    await fetch(
      getApiUrl(
        `meeting/bodies?workspaceId=${workspaceId}${includeInactive ? "&includeInactive=true" : ""}`,
      ),
      { credentials: "include" },
    ),
  );
}

export async function createCommittee(
  workspaceId: string,
  body: {
    name: string;
    description?: string | null;
    quorumRule?: string | null;
  },
): Promise<Committee> {
  return jsonOrThrow(
    await fetch(
      getApiUrl("meeting/bodies"),
      jsonInit("POST", { workspaceId, ...body }),
    ),
  );
}

export async function updateCommittee(
  workspaceId: string,
  id: string,
  body: Partial<
    Pick<Committee, "name" | "description" | "quorumRule" | "active">
  >,
): Promise<Committee> {
  return jsonOrThrow(
    await fetch(
      getApiUrl(`meeting/bodies/${id}`),
      jsonInit("PUT", { workspaceId, ...body }),
    ),
  );
}

export async function listCommitteeMembers(
  workspaceId: string,
  bodyId: string,
): Promise<CommitteeMember[]> {
  return jsonOrThrow(
    await fetch(
      getApiUrl(`meeting/bodies/${bodyId}/members?workspaceId=${workspaceId}`),
      { credentials: "include" },
    ),
  );
}

export async function addCommitteeMember(
  workspaceId: string,
  bodyId: string,
  body: { userId?: string | null; name?: string | null; role: CommitteeRole },
) {
  return jsonOrThrow(
    await fetch(
      getApiUrl(`meeting/bodies/${bodyId}/members`),
      jsonInit("POST", { workspaceId, ...body }),
    ),
  );
}

export async function updateCommitteeMember(
  workspaceId: string,
  bodyId: string,
  memberId: string,
  body: { role?: CommitteeRole; active?: boolean },
) {
  return jsonOrThrow(
    await fetch(
      getApiUrl(`meeting/bodies/${bodyId}/members/${memberId}`),
      jsonInit("PUT", { workspaceId, ...body }),
    ),
  );
}

export async function listOfficeHolders(
  workspaceId: string,
): Promise<OfficeHolder[]> {
  return jsonOrThrow(
    await fetch(
      getApiUrl(`organisation/positions?workspaceId=${workspaceId}`),
      { credentials: "include" },
    ),
  );
}

export async function setOfficeHolder(
  workspaceId: string,
  key: OfficeHolder["key"],
  body: { holderUserId: string | null; actingUserId?: string | null },
): Promise<OfficeHolder[]> {
  return jsonOrThrow(
    await fetch(
      getApiUrl(`organisation/positions/${key}`),
      jsonInit("PUT", { workspaceId, ...body }),
    ),
  );
}
