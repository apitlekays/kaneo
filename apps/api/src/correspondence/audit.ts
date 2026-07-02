import { createHash } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import db from "../database";
import { gmAuditEventTable } from "../database/schema";

// Accepts either the root db or a transaction — both expose these methods.
type DbExecutor = Pick<typeof db, "select" | "insert" | "execute">;

/**
 * Deterministic JSON: object keys sorted recursively so the same logical
 * payload always hashes identically regardless of property order.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`)
    .join(",")}}`;
}

/**
 * Coerce a payload into exactly the JSON shape Postgres will persist in jsonb
 * (Dates → ISO strings, undefined dropped). Hashing this same normalized form
 * guarantees the write-time hash matches what verification recomputes from the
 * stored row.
 */
function toJsonSafe(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function computeHash(prevHash: string | null, payload: string) {
  return createHash("sha256")
    .update(`${prevHash ?? ""}${payload}`)
    .digest("hex");
}

export type AuditParams = {
  workspaceId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  deviceInfo?: string | null;
};

/**
 * Append one tamper-evident event to the workspace's audit chain.
 *
 * MUST be called inside a transaction so the event commits atomically with the
 * change it records. A per-workspace advisory lock serializes writers so the
 * hash chain can never fork; "the last event" is read by the monotonic `seq`.
 */
export async function recordAuditEvent(tx: DbExecutor, params: AuditParams) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`,
  );

  const [prev] = await tx
    .select({ hash: gmAuditEventTable.hash })
    .from(gmAuditEventTable)
    .where(eq(gmAuditEventTable.workspaceId, params.workspaceId))
    .orderBy(desc(gmAuditEventTable.seq))
    .limit(1);

  const prevHash = prev?.hash ?? null;
  const at = new Date();
  // Normalize to the exact jsonb shape that gets stored, then hash THAT — so
  // verification recomputes an identical hash from the persisted row.
  const before = toJsonSafe(params.before);
  const after = toJsonSafe(params.after);
  const payload = canonicalize({
    workspaceId: params.workspaceId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actorId: params.actorId ?? null,
    before,
    after,
    at: at.toISOString(),
  });
  const hash = computeHash(prevHash, payload);

  await tx.insert(gmAuditEventTable).values({
    workspaceId: params.workspaceId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actorId: params.actorId ?? null,
    at,
    ip: params.ip ?? null,
    deviceInfo: params.deviceInfo ?? null,
    before: before as never,
    after: after as never,
    prevHash,
    hash,
  });

  return { hash, prevHash };
}

/**
 * Re-walk a workspace's chain in insertion order and recompute every hash.
 * Returns ok=false with the offending seq if any link doesn't verify — proof
 * the log was altered out-of-band.
 */
export async function verifyAuditChain(workspaceId: string) {
  const rows = await db
    .select()
    .from(gmAuditEventTable)
    .where(eq(gmAuditEventTable.workspaceId, workspaceId))
    .orderBy(asc(gmAuditEventTable.seq));

  let prevHash: string | null = null;
  for (const row of rows) {
    const payload = canonicalize({
      workspaceId: row.workspaceId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      actorId: row.actorId ?? null,
      before: row.before ?? null,
      after: row.after ?? null,
      at: row.at.toISOString(),
    });
    const expected = computeHash(prevHash, payload);
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return { ok: false, count: rows.length, brokenAtSeq: row.seq };
    }
    prevHash = row.hash;
  }
  return { ok: true, count: rows.length };
}
