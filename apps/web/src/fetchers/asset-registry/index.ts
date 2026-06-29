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
  purchaseDate: string | null;
  purchaseCost: number | null;
  currency: string;
  vendor: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  nextRenewalDate?: string | null;
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

export type AssetDetail = {
  asset: Asset;
  renewals: AssetRenewal[];
  maintenance: AssetMaintenance[];
  costs: AssetCost[];
  trips: AssetTrip[];
  files: AssetFile[];
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
