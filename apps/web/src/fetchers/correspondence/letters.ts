import { getApiUrl } from "@/fetchers/get-api-url";
import { isPdfUpload } from "@/lib/is-pdf-upload";

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
  externalRefNo: string | null;
  urgency: string;
  organisationId: string | null;
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
  // Present on the list endpoint: delegated-action progress.
  actionsTotal?: number;
  actionsDone?: number;
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
  assigneeId: string | null;
  dueAt: string | null;
  status: string;
  completedAt: string | null;
  completedBy: string | null;
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
  // Present on the letter detail response only: true when this letter is
  // the `from` side of the link, false when it is the `to` side. Absent on
  // the plain create-link response.
  outbound?: boolean;
};
export type DraftVersion = {
  id: string;
  letterId: string;
  version: number;
  bodyHtml: string;
  createdBy: string | null;
  createdAt: string;
};
export type ApprovalStepInstance = {
  id: string;
  instanceId: string;
  stepOrder: number;
  mode: string;
  approverType: "role" | "users";
  approverRefs: string[];
  quorum: number;
  status: string;
  decisions:
    | { userId: string; decision: string; comment?: string; at: string }[]
    | null;
  dueAt: string | null;
  decidedAt: string | null;
  createdAt: string;
};
export type ApprovalInstance = {
  id: string;
  letterId: string;
  chainId: string | null;
  chainName: string | null;
  status: string;
  createdAt: string;
  steps: ApprovalStepInstance[];
};

export type LetterSignature = {
  id: string;
  letterId: string;
  signerId: string | null;
  method: string;
  signedObjectKey: string | null;
  signedHash: string | null;
  manifest: {
    signerName?: string;
    role?: string;
    signedAt?: string;
    documentSha256?: string;
    certSubject?: string;
  } | null;
  signedAt: string;
};

export type LetterDispatch = {
  id: string;
  letterId: string;
  method: string;
  distributionListIds: string[] | null;
  recipients: { name?: string; email?: string }[] | null;
  dispatchedBy: string | null;
  dispatchedAt: string;
  providerMessageId: string | null;
  deliveryStatus: string | null;
  trackingNo: string | null;
};

export type LetterLegalHold = {
  id: string;
  letterId: string;
  reason: string;
  placedBy: string | null;
  placedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};
export type LetterDisposition = {
  id: string;
  letterId: string;
  action: string;
  authorizedBy: string | null;
  certificateObjectKey: string | null;
  certificateHash: string | null;
  note: string | null;
  executedAt: string;
};

export type LetterDetail = Letter & {
  attachments: LetterAttachment[];
  minutes: LetterMinute[];
  assignments: LetterAssignment[];
  links: LetterLink[];
  approval: ApprovalInstance | null;
  versions: DraftVersion[];
  signature: LetterSignature | null;
  dispatches: LetterDispatch[];
  holds: LetterLegalHold[];
  dispositions: LetterDisposition[];
};

export type DispositionQueueItem = {
  letter: Letter;
  className: string;
  dueAt: string;
  action: string;
};

export type CorrespondenceSummary = {
  total: number;
  incoming: number;
  outgoing: number;
  pendingRegistration: number;
  unassigned: number;
  overdue: number;
  onHold: number;
  dueForDisposition: number;
  byStatus: Record<string, number>;
};

export type LetterFilters = {
  direction?: "in" | "out";
  type?: string;
  status?: string;
  q?: string;
  /** Show the disposed archive instead of the working register. */
  disposed?: boolean;
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
  if (filters.disposed) params.set("disposed", "true");
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

export const completeMinute = (workspaceId: string, id: string, mid: string) =>
  post<LetterMinute>(`letters/${id}/minutes/${mid}/complete`, workspaceId, {});

export type PendingAssignment = {
  id: string;
  letterId: string;
  refNo: string | null;
  subject: string;
  action: string | null;
  note: string | null;
  createdAt: string;
};

export type MyCorrespondence = {
  letters: {
    id: string;
    refNo: string | null;
    subject: string;
    direction: "in" | "out";
    status: string;
    urgency: string;
    receivedAt: string | null;
    createdAt: string;
  }[];
  actions: {
    id: string;
    letterId: string;
    body: string;
    actionType: string | null;
    dueAt: string | null;
    createdAt: string;
    refNo: string | null;
    subject: string;
  }[];
  pendingAssignments: PendingAssignment[];
};

export async function getMyCorrespondence(
  workspaceId: string,
): Promise<MyCorrespondence> {
  return jsonOrThrow(
    await fetch(url(`my-correspondence?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

export const acceptAssignment = (
  workspaceId: string,
  letterId: string,
  assignmentId: string,
) =>
  post<Letter>(
    `letters/${letterId}/assignments/${assignmentId}/accept`,
    workspaceId,
    {},
  );

export const rejectAssignment = (
  workspaceId: string,
  letterId: string,
  assignmentId: string,
  note?: string,
) =>
  post<Letter>(
    `letters/${letterId}/assignments/${assignmentId}/reject`,
    workspaceId,
    { note },
  );

export type WatchlistAssignment = PendingAssignment & {
  toUserId: string | null;
  /** "pending" — nobody has answered yet; "rejected" — refused and unresolved. */
  status: string;
  decidedAt: string | null;
  /** Who the letter fell back to. Null means it is owned by nobody. */
  currentAssigneeId: string | null;
  externalRefNo: string | null;
  direction: "in" | "out";
};

export async function getAwaitingAcceptance(
  workspaceId: string,
): Promise<WatchlistAssignment[]> {
  return jsonOrThrow(
    await fetch(url(`letters/awaiting-acceptance?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

export const setLetterStatus = (
  workspaceId: string,
  id: string,
  status: string,
) => post<Letter>(`letters/${id}/status`, workspaceId, { status });

export const linkLetter = (workspaceId: string, id: string, body: object) =>
  post<LetterLink>(`letters/${id}/links`, workspaceId, body);

// ── Outgoing pipeline (Block 3) ──────────────────────────────────────────────
export const saveDraftVersion = (
  workspaceId: string,
  id: string,
  bodyHtml: string,
) =>
  post<DraftVersion>(`letters/${id}/draft-version`, workspaceId, { bodyHtml });

export const submitReview = (workspaceId: string, id: string) =>
  post<Letter>(`letters/${id}/submit-review`, workspaceId, {});

export const reviewDecision = (
  workspaceId: string,
  id: string,
  body: { decision: "approve" | "return"; comment?: string },
) => post<Letter>(`letters/${id}/review-decision`, workspaceId, body);

export const approvalDecision = (
  workspaceId: string,
  id: string,
  body: {
    stepInstanceId: string;
    decision: "approve" | "reject" | "return";
    comment?: string;
  },
) => post<Letter>(`letters/${id}/approval-decision`, workspaceId, body);

export const signLetter = (workspaceId: string, id: string) =>
  post<Letter>(`letters/${id}/sign`, workspaceId, {});

export const dispatchLetter = (
  workspaceId: string,
  id: string,
  body: {
    method: "email" | "post" | "courier" | "hand" | "group";
    distributionListIds?: string[];
    recipients?: { name?: string; email?: string }[];
    trackingNo?: string;
    coverNote?: string;
  },
) => post<Letter>(`letters/${id}/dispatch`, workspaceId, body);

// ── Records lifecycle (Block 4) ──────────────────────────────────────────────
export const setRetention = (
  workspaceId: string,
  id: string,
  retentionClassId: string,
) => post<Letter>(`letters/${id}/retention`, workspaceId, { retentionClassId });

export const placeLegalHold = (
  workspaceId: string,
  id: string,
  reason: string,
) => post<Letter>(`letters/${id}/legal-hold`, workspaceId, { reason });

export const releaseLegalHold = (workspaceId: string, id: string) =>
  post<Letter>(`letters/${id}/legal-hold/release`, workspaceId, {});

export const disposeLetter = (
  workspaceId: string,
  id: string,
  body: {
    action: "destroy" | "transfer" | "permanent" | "review";
    note?: string;
  },
) => post<Letter>(`letters/${id}/dispose`, workspaceId, body);

export async function getDispositionQueue(
  workspaceId: string,
): Promise<DispositionQueueItem[]> {
  return jsonOrThrow(
    await fetch(url(`disposition-queue?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

export const dispositionCertificateUrl = (workspaceId: string, id: string) =>
  url(`letters/${id}/disposition/certificate?workspaceId=${workspaceId}`);

export const reportRegisterUrl = (
  workspaceId: string,
  direction?: "in" | "out",
) =>
  url(
    `reports/register?workspaceId=${workspaceId}${direction ? `&direction=${direction}` : ""}`,
  );
export const reportDispositionUrl = (workspaceId: string) =>
  url(`reports/disposition?workspaceId=${workspaceId}`);
export const reportAuditUrl = (workspaceId: string) =>
  url(`reports/audit?workspaceId=${workspaceId}`);

export const verifySignature = async (
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; reason?: string }> =>
  jsonOrThrow(
    await fetch(
      url(`letters/${id}/signature/verify?workspaceId=${workspaceId}`),
      { credentials: "include" },
    ),
  );

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

/** Same bytes, but recorded as a preview rather than a download. */
export const attachmentPreviewUrl = (
  workspaceId: string,
  id: string,
  aid: string,
) =>
  url(
    `letters/${id}/attachments/${aid}/download?workspaceId=${workspaceId}&preview=true`,
  );

/** Presign → direct PUT to storage → finalize. */
export async function uploadLetterAttachment(
  workspaceId: string,
  letterId: string,
  file: File,
  kind = "original",
): Promise<LetterAttachment> {
  if (!isPdfUpload(file)) {
    throw new Error("Only PDF files can be attached to a letter");
  }
  const contentType = "application/pdf";
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
