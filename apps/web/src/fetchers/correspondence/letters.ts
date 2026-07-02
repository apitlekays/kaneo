import { getApiUrl } from "@/fetchers/get-api-url";

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const jsonHeaders = { "Content-Type": "application/json" };
const url = (path: string) => getApiUrl(`correspondence/${path}`);

export type Letter = {
  id: string;
  workspaceId: string;
  refNo: string | null;
  fileRef: string | null;
  jilid: number | null;
  direction: "in" | "out";
  type: "external" | "memo" | "circular";
  medium: "email" | "physical" | "hand" | "portal";
  subject: string;
  senderName: string | null;
  senderOrg: string | null;
  senderEmail: string | null;
  recipientName: string | null;
  recipientOrg: string | null;
  recipientEmail: string | null;
  letterDate: string | null;
  receivedAt: string | null;
  dispatchedAt: string | null;
  categoryId: string | null;
  filePlanNodeId: string | null;
  securityLabelId: string | null;
  numberSchemeId: string | null;
  retentionClassId: string | null;
  status: string;
  dispositionStatus: string | null;
  legalHold: boolean;
  primaryAttachmentId: string | null;
  contentHash: string | null;
  currentAssigneeId: string | null;
  createdBy: string | null;
  declaredAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LetterAttachment = {
  id: string;
  letterId: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string | null;
  kind: string;
  createdAt: string;
};
export type LetterMinute = {
  id: string;
  letterId: string;
  authorId: string | null;
  body: string;
  actionType: string | null;
  createdAt: string;
};
export type LetterAssignment = {
  id: string;
  letterId: string;
  fromUserId: string | null;
  toUserId: string | null;
  toDeptId: string | null;
  action: string | null;
  status: string;
  dueAt: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
};
export type LetterLink = {
  id: string;
  fromLetterId: string;
  toLetterId: string;
  relation: string;
  createdAt: string;
};
export type LetterDetail = Letter & {
  attachments: LetterAttachment[];
  minutes: LetterMinute[];
  assignments: LetterAssignment[];
  links: LetterLink[];
};

export type CorrespondenceSummary = {
  total: number;
  incoming: number;
  outgoing: number;
  pendingRegistration: number;
  unassigned: number;
  overdue: number;
  byStatus: Record<string, number>;
};

export type LetterFilters = {
  direction?: "in" | "out";
  type?: string;
  status?: string;
  q?: string;
};

export async function listLetters(
  workspaceId: string,
  filters: LetterFilters = {},
): Promise<Letter[]> {
  const params = new URLSearchParams({ workspaceId });
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  return jsonOrThrow(
    await fetch(url(`letters?${params.toString()}`), {
      credentials: "include",
    }),
  );
}

export async function getLetter(
  workspaceId: string,
  id: string,
): Promise<LetterDetail> {
  return jsonOrThrow(
    await fetch(url(`letters/${id}?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

export async function getCorrespondenceSummary(
  workspaceId: string,
): Promise<CorrespondenceSummary> {
  return jsonOrThrow(
    await fetch(url(`summary?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

function post<T>(path: string, workspaceId: string, body: object): Promise<T> {
  return fetch(url(path), {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ workspaceId, ...body }),
  }).then(jsonOrThrow<T>);
}

export const createLetter = (workspaceId: string, body: object) =>
  post<Letter>("letters", workspaceId, body);

export const updateLetter = (workspaceId: string, id: string, body: object) =>
  fetch(url(`letters/${id}`), {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ workspaceId, ...body }),
  }).then(jsonOrThrow<Letter>);

export const registerLetter = (
  workspaceId: string,
  id: string,
  numberSchemeId?: string,
) => post<Letter>(`letters/${id}/register`, workspaceId, { numberSchemeId });

export const classifyLetter = (workspaceId: string, id: string, body: object) =>
  post<Letter>(`letters/${id}/classify`, workspaceId, body);

export const routeLetter = (workspaceId: string, id: string, body: object) =>
  post<Letter>(`letters/${id}/route`, workspaceId, body);

export const addMinute = (workspaceId: string, id: string, body: object) =>
  post<LetterMinute>(`letters/${id}/minutes`, workspaceId, body);

export const setLetterStatus = (
  workspaceId: string,
  id: string,
  status: string,
) => post<Letter>(`letters/${id}/status`, workspaceId, { status });

export const linkLetter = (workspaceId: string, id: string, body: object) =>
  post<LetterLink>(`letters/${id}/links`, workspaceId, body);

export type PresignResult = {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

export const presignAttachment = (
  workspaceId: string,
  id: string,
  body: { filename: string; contentType: string; kind?: string },
) =>
  post<PresignResult>(`letters/${id}/attachments/presign`, workspaceId, body);

export const finalizeAttachment = (
  workspaceId: string,
  id: string,
  body: {
    objectKey: string;
    filename: string;
    mimeType: string;
    size: number;
    kind?: string;
  },
) =>
  post<LetterAttachment>(
    `letters/${id}/attachments/finalize`,
    workspaceId,
    body,
  );

export const attachmentDownloadUrl = (
  workspaceId: string,
  id: string,
  aid: string,
) =>
  url(`letters/${id}/attachments/${aid}/download?workspaceId=${workspaceId}`);

/** Presign → direct PUT to storage → finalize. */
export async function uploadLetterAttachment(
  workspaceId: string,
  letterId: string,
  file: File,
  kind = "original",
): Promise<LetterAttachment> {
  const contentType = file.type || "application/octet-stream";
  const presign = await presignAttachment(workspaceId, letterId, {
    filename: file.name,
    contentType,
    kind,
  });
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: file,
  });
  if (!put.ok) throw new Error("Upload to storage failed");
  return finalizeAttachment(workspaceId, letterId, {
    objectKey: presign.key,
    filename: file.name,
    mimeType: contentType,
    size: file.size,
    kind,
  });
}
