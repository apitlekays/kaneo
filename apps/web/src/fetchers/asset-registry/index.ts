import { getApiUrl } from "@/fetchers/get-api-url";

export type Asset = {
  id: string;
  workspaceId: string;
  serialNumber: string;
  assetTag: string | null;
  name: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  status: string;
  location: string | null;
  assignedTo: string | null;
  registrationNumber: string | null;
  currentCustodianId: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  currency: string;
  depreciationMethod: string;
  usefulLifeMonths: number | null;
  salvageValue: number | null;
  inServiceDate: string | null;
  vendor: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  nextRenewalDate?: string | null;
  custodianName?: string | null;
  custodianImage?: string | null;
};

export type AssetCustody = {
  id: string;
  userId: string | null;
  userName: string | null;
  userImage: string | null;
  assignedBy: string | null;
  assignedAt: string;
  releasedAt: string | null;
  note: string | null;
};

export type AssetActivity = {
  id: string;
  type: string;
  userId: string | null;
  userName: string | null;
  userImage: string | null;
  eventData: Record<string, unknown> | null;
  createdAt: string;
};

export type AssetRenewal = {
  id: string;
  assetId: string;
  type: string;
  label: string | null;
  dueDate: string;
  lastRenewedDate: string | null;
  cost: number | null;
  notes: string | null;
};

export type AssetMaintenance = {
  id: string;
  assetId: string;
  date: string;
  title: string;
  notes: string | null;
  cost: number | null;
  vendor: string | null;
};

export type AssetCost = {
  id: string;
  assetId: string;
  date: string;
  category: string;
  amount: number;
  note: string | null;
};

export type AssetTrip = {
  id: string;
  assetId: string;
  date: string;
  origin: string | null;
  destination: string | null;
  distanceKm: number | null;
  purpose: string | null;
  driver: string | null;
  cost: number | null;
  notes: string | null;
};

export type AssetFile = {
  id: string;
  assetId: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
  createdAt: string;
};

export type DepreciationScheduleRow = {
  year: number;
  depreciation: number;
  openingValue: number;
  closingValue: number;
};

export type AssetDepreciation = {
  method: string;
  usefulLifeMonths: number | null;
  salvageValue: number | null;
  inServiceDate: string | null;
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  netBookValue: number | null;
  schedule: DepreciationScheduleRow[];
};

export type AssetDisposal = {
  id: string;
  assetId: string;
  date: string;
  method: string;
  proceeds: number | null;
  reason: string | null;
  approvedBy: string | null;
  notes: string | null;
  createdAt: string;
};

export type PmSchedule = {
  id: string;
  assetId: string;
  title: string;
  intervalType: string;
  intervalValue: number;
  lastDoneDate: string | null;
  nextDueDate: string;
  active: boolean;
  notes: string | null;
};

export type WorkOrder = {
  id: string;
  assetId: string;
  assetName?: string;
  pmScheduleId: string | null;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
  dueDate: string | null;
  completedAt: string | null;
  cost: number | null;
  createdAt: string;
};

export type AssetDetail = {
  asset: Asset;
  renewals: AssetRenewal[];
  maintenance: AssetMaintenance[];
  costs: AssetCost[];
  trips: AssetTrip[];
  files: AssetFile[];
  custody: AssetCustody[];
  activity: AssetActivity[];
  pmSchedules: PmSchedule[];
  workOrders: WorkOrder[];
  depreciation: AssetDepreciation;
  disposal: AssetDisposal | null;
};

export type RenewalSummaryItem = {
  id: string;
  assetId: string;
  assetName: string;
  type: string;
  label: string | null;
  dueDate: string;
};

export type AssetSummary = {
  totalAssets: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  purchaseTotal: number;
  spendTotal: number;
  totalValue: number;
  totalNetBookValue: number;
  disposedCount: number;
  overdueRenewals: RenewalSummaryItem[];
  upcomingRenewals: RenewalSummaryItem[];
  overdueCount: number;
  upcomingCount: number;
};

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function api(path: string) {
  return getApiUrl(`asset-registry/${path}`);
}

const jsonHeaders = { "Content-Type": "application/json" };

export function assetFileUrl(fileId: string) {
  return api(`file/${fileId}`);
}

export async function listAssets(workspaceId: string): Promise<Asset[]> {
  return jsonOrThrow(
    await fetch(api(`?workspaceId=${workspaceId}`), { credentials: "include" }),
  );
}

export async function getAssetSummary(
  workspaceId: string,
): Promise<AssetSummary> {
  return jsonOrThrow(
    await fetch(api(`summary?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

export async function getAsset(
  workspaceId: string,
  id: string,
): Promise<AssetDetail> {
  return jsonOrThrow(
    await fetch(api(`${id}?workspaceId=${workspaceId}`), {
      credentials: "include",
    }),
  );
}

export type AssetInput = {
  name: string;
  category?: string;
  status?: string;
  assetTag?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  location?: string | null;
  assignedTo?: string | null;
  registrationNumber?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  currency?: string;
  depreciationMethod?: string;
  usefulLifeMonths?: number | null;
  salvageValue?: number | null;
  inServiceDate?: string | null;
  vendor?: string | null;
  notes?: string | null;
};

export async function createAsset(
  workspaceId: string,
  data: AssetInput,
): Promise<Asset> {
  return jsonOrThrow(
    await fetch(api(""), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId, ...data }),
    }),
  );
}

export async function updateAsset(
  workspaceId: string,
  id: string,
  data: AssetInput,
): Promise<Asset> {
  return jsonOrThrow(
    await fetch(api(`${id}?workspaceId=${workspaceId}`), {
      method: "PUT",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }),
  );
}

export async function deleteAsset(workspaceId: string, id: string) {
  return jsonOrThrow(
    await fetch(api(`${id}?workspaceId=${workspaceId}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

export async function setCustodian(
  workspaceId: string,
  assetId: string,
  userId: string,
  note?: string,
) {
  return jsonOrThrow(
    await fetch(api(`${assetId}/custody`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId, userId, note: note ?? null }),
    }),
  );
}

export async function releaseCustodian(workspaceId: string, assetId: string) {
  return jsonOrThrow(
    await fetch(api(`${assetId}/custody/release`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId }),
    }),
  );
}

export type DisposalInput = {
  date: string;
  method?: string;
  proceeds?: number | null;
  reason?: string | null;
  approvedBy?: string | null;
  notes?: string | null;
};

export async function createDisposal(
  workspaceId: string,
  assetId: string,
  body: DisposalInput,
) {
  return jsonOrThrow(
    await fetch(api(`${assetId}/disposal`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId, ...body }),
    }),
  );
}

export async function deleteDisposal(workspaceId: string, assetId: string) {
  return jsonOrThrow(
    await fetch(api(`${assetId}/disposal?workspaceId=${workspaceId}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

// ── Preventive maintenance schedules ─────────────────────────────────────────

export const addPmSchedule = (
  ws: string,
  assetId: string,
  body: Record<string, unknown>,
) => postEntry<PmSchedule>(ws, assetId, "pm-schedules", body);

export async function updatePmSchedule(
  ws: string,
  assetId: string,
  scheduleId: string,
  body: Record<string, unknown>,
): Promise<PmSchedule> {
  return jsonOrThrow(
    await fetch(api(`${assetId}/pm-schedules/${scheduleId}`), {
      method: "PUT",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId: ws, ...body }),
    }),
  );
}

export const deletePmSchedule = (
  ws: string,
  assetId: string,
  scheduleId: string,
) => deleteEntry(ws, assetId, "pm-schedules", scheduleId);

// ── Work orders ──────────────────────────────────────────────────────────────

export const createWorkOrder = (
  ws: string,
  assetId: string,
  body: Record<string, unknown>,
) => postEntry<WorkOrder>(ws, assetId, "work-orders", body);

export async function listWorkOrders(
  ws: string,
  params: { assigneeId?: string; status?: string } = {},
): Promise<WorkOrder[]> {
  const q = new URLSearchParams({ workspaceId: ws });
  if (params.assigneeId) q.set("assigneeId", params.assigneeId);
  if (params.status) q.set("status", params.status);
  return jsonOrThrow(
    await fetch(api(`work-orders?${q.toString()}`), { credentials: "include" }),
  );
}

export async function updateWorkOrder(
  ws: string,
  woId: string,
  body: Record<string, unknown>,
): Promise<WorkOrder> {
  return jsonOrThrow(
    await fetch(api(`work-orders/${woId}?workspaceId=${ws}`), {
      method: "PUT",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteWorkOrder(ws: string, woId: string) {
  return jsonOrThrow(
    await fetch(api(`work-orders/${woId}?workspaceId=${ws}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

// ── Sub-resources ──────────────────────────────────────────────────────────

async function postEntry<T>(
  workspaceId: string,
  assetId: string,
  resource: string,
  body: Record<string, unknown>,
): Promise<T> {
  return jsonOrThrow(
    await fetch(api(`${assetId}/${resource}`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId, ...body }),
    }),
  );
}

async function deleteEntry(
  workspaceId: string,
  assetId: string,
  resource: string,
  entryId: string,
) {
  return jsonOrThrow(
    await fetch(
      api(`${assetId}/${resource}/${entryId}?workspaceId=${workspaceId}`),
      { method: "DELETE", credentials: "include" },
    ),
  );
}

export const addRenewal = (
  ws: string,
  assetId: string,
  body: Partial<AssetRenewal>,
) => postEntry<AssetRenewal>(ws, assetId, "renewals", body);
export const deleteRenewal = (ws: string, assetId: string, id: string) =>
  deleteEntry(ws, assetId, "renewals", id);

export const addMaintenance = (
  ws: string,
  assetId: string,
  body: Partial<AssetMaintenance>,
) => postEntry<AssetMaintenance>(ws, assetId, "maintenance", body);
export const deleteMaintenance = (ws: string, assetId: string, id: string) =>
  deleteEntry(ws, assetId, "maintenance", id);

export const addCost = (
  ws: string,
  assetId: string,
  body: Partial<AssetCost>,
) => postEntry<AssetCost>(ws, assetId, "costs", body);
export const deleteCost = (ws: string, assetId: string, id: string) =>
  deleteEntry(ws, assetId, "costs", id);

export const addTrip = (
  ws: string,
  assetId: string,
  body: Partial<AssetTrip>,
) => postEntry<AssetTrip>(ws, assetId, "trips", body);
export const deleteTrip = (ws: string, assetId: string, id: string) =>
  deleteEntry(ws, assetId, "trips", id);

// ── Files: presign → PUT to S3 → finalize ────────────────────────────────────

export async function uploadAssetFile(
  workspaceId: string,
  assetId: string,
  file: File,
): Promise<AssetFile> {
  const presign = await jsonOrThrow<{
    uploadUrl: string;
    key: string;
    headers: Record<string, string>;
    kind: "image" | "document";
  }>(
    await fetch(api(`${assetId}/files/upload`), {
      method: "PUT",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({
        workspaceId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      }),
    }),
  );

  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: file,
  });
  if (!put.ok) throw new Error("Upload to storage failed");

  return jsonOrThrow(
    await fetch(api(`${assetId}/files/finalize`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({
        workspaceId,
        objectKey: presign.key,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        kind: presign.kind,
      }),
    }),
  );
}

export const deleteAssetFile = (ws: string, assetId: string, fileId: string) =>
  deleteEntry(ws, assetId, "files", fileId);
