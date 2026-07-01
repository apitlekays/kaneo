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
  locationId: string | null;
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
  customFields: Record<string, unknown> | null;
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
  driverId: string | null;
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
  nextDueDate: string | null;
  lastDoneMeter: number | null;
  nextDueMeter: number | null;
  active: boolean;
  notes: string | null;
};

export type MeterReading = {
  id: string;
  assetId: string;
  date: string;
  value: number;
  unit: string;
  note: string | null;
};

export type FuelLog = {
  id: string;
  date: string;
  volume: number | null;
  cost: number | null;
  odometer: number | null;
  driverId: string | null;
  driverName: string | null;
  note: string | null;
};

export type Driver = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  profileId: string | null;
  licenceNo: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  phone: string | null;
};

export type AssetLocation = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  type: string;
};

export type AuditSession = {
  id: string;
  name: string;
  startedBy: string | null;
  startedAt: string;
  closedAt: string | null;
};

export type AuditScan = {
  id: string;
  assetId: string | null;
  assetName: string | null;
  scannedSerial: string;
  status: string;
  scannedAt: string;
};

export type AuditSessionDetail = {
  session: AuditSession;
  scans: AuditScan[];
  missing: Array<{
    id: string;
    name: string;
    serialNumber: string;
    status: string;
  }>;
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
  meterReadings: MeterReading[];
  fuelLogs: FuelLog[];
  currentOdometer: number | null;
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
  // Avoid a trailing slash on the bare collection (`asset-registry?…` /
  // `asset-registry`) — the mounted Hono router doesn't match `/asset-registry/`.
  const sep = path === "" || path.startsWith("?") ? "" : "/";
  return getApiUrl(`asset-registry${sep}${path}`);
}

const jsonHeaders = { "Content-Type": "application/json" };

export function assetFileUrl(fileId: string) {
  return api(`file/${fileId}`);
}

export type PublicAsset = {
  id: string;
  name: string;
  serialNumber: string;
  assetTag: string | null;
  category: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  registrationNumber: string | null;
  locationName: string | null;
  custodianName: string | null;
  organizationName: string | null;
  hasImage: boolean;
};

/** Public, unauthenticated asset view (QR-code target). */
export async function getPublicAsset(id: string): Promise<PublicAsset> {
  return jsonOrThrow(await fetch(getApiUrl(`public-asset/${id}`)));
}

export function publicAssetImageUrl(id: string) {
  return getApiUrl(`public-asset/${id}/image`);
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
  customFields?: Record<string, unknown> | null;
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

// ── Fleet: meter readings + fuel log ─────────────────────────────────────────

export const addMeterReading = (
  ws: string,
  assetId: string,
  body: Record<string, unknown>,
) => postEntry<MeterReading>(ws, assetId, "meter", body);
export const deleteMeterReading = (ws: string, assetId: string, id: string) =>
  deleteEntry(ws, assetId, "meter", id);

export const addFuelLog = (
  ws: string,
  assetId: string,
  body: Record<string, unknown>,
) => postEntry<FuelLog>(ws, assetId, "fuel", body);
export const deleteFuelLog = (ws: string, assetId: string, id: string) =>
  deleteEntry(ws, assetId, "fuel", id);

// ── Drivers ──────────────────────────────────────────────────────────────────

export async function listDrivers(ws: string): Promise<Driver[]> {
  return jsonOrThrow(
    await fetch(api(`drivers?workspaceId=${ws}`), { credentials: "include" }),
  );
}

export async function upsertDriver(
  ws: string,
  userId: string,
  body: Record<string, unknown>,
) {
  return jsonOrThrow(
    await fetch(api(`drivers/${userId}?workspaceId=${ws}`), {
      method: "PUT",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteDriver(ws: string, userId: string) {
  return jsonOrThrow(
    await fetch(api(`drivers/${userId}?workspaceId=${ws}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

// ── Locations ────────────────────────────────────────────────────────────────

export async function listLocations(ws: string): Promise<AssetLocation[]> {
  return jsonOrThrow(
    await fetch(api(`locations?workspaceId=${ws}`), { credentials: "include" }),
  );
}

export async function createLocation(
  ws: string,
  body: Record<string, unknown>,
): Promise<AssetLocation> {
  return jsonOrThrow(
    await fetch(api("locations"), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId: ws, ...body }),
    }),
  );
}

export async function deleteLocation(ws: string, locId: string) {
  return jsonOrThrow(
    await fetch(api(`locations/${locId}?workspaceId=${ws}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

// ── Stock-take ───────────────────────────────────────────────────────────────

export async function listAuditSessions(ws: string): Promise<AuditSession[]> {
  return jsonOrThrow(
    await fetch(api(`audit-sessions?workspaceId=${ws}`), {
      credentials: "include",
    }),
  );
}

export async function createAuditSession(
  ws: string,
  name: string,
): Promise<AuditSession> {
  return jsonOrThrow(
    await fetch(api("audit-sessions"), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId: ws, name }),
    }),
  );
}

export async function getAuditSession(
  ws: string,
  sessionId: string,
): Promise<AuditSessionDetail> {
  return jsonOrThrow(
    await fetch(api(`audit-sessions/${sessionId}?workspaceId=${ws}`), {
      credentials: "include",
    }),
  );
}

export async function scanAudit(
  ws: string,
  sessionId: string,
  serial: string,
): Promise<{ found: boolean; status: string }> {
  return jsonOrThrow(
    await fetch(api(`audit-sessions/${sessionId}/scan`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId: ws, serial }),
    }),
  );
}

export async function closeAuditSession(ws: string, sessionId: string) {
  return jsonOrThrow(
    await fetch(api(`audit-sessions/${sessionId}/close`), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId: ws }),
    }),
  );
}

export async function deleteAuditSession(ws: string, sessionId: string) {
  return jsonOrThrow(
    await fetch(api(`audit-sessions/${sessionId}?workspaceId=${ws}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

// ── Export / import ──────────────────────────────────────────────────────────

export type ExportRow = Record<string, string | number | null>;

export async function exportAssets(ws: string): Promise<ExportRow[]> {
  return jsonOrThrow(
    await fetch(api(`export?workspaceId=${ws}`), { credentials: "include" }),
  );
}

export async function importAssets(
  ws: string,
  assets: Array<Record<string, unknown>>,
): Promise<{ imported: number; failed: number }> {
  return jsonOrThrow(
    await fetch(api("import"), {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({ workspaceId: ws, assets }),
    }),
  );
}

export type RenewalRegisterItem = {
  id: string;
  assetId: string;
  assetName: string;
  type: string;
  label: string | null;
  dueDate: string;
  cost: number | null;
  currency: string;
};

export async function listAllRenewals(
  ws: string,
): Promise<RenewalRegisterItem[]> {
  return jsonOrThrow(
    await fetch(api(`renewals?workspaceId=${ws}`), { credentials: "include" }),
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

async function putEntry<T>(
  workspaceId: string,
  assetId: string,
  resource: string,
  entryId: string,
  body: Record<string, unknown>,
): Promise<T> {
  return jsonOrThrow(
    await fetch(api(`${assetId}/${resource}/${entryId}`), {
      method: "PUT",
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
export const updateRenewal = (
  ws: string,
  assetId: string,
  id: string,
  body: Partial<AssetRenewal>,
) => putEntry<AssetRenewal>(ws, assetId, "renewals", id, body);
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
