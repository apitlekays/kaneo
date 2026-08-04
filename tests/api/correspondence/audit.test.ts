import { beforeEach, describe, expect, it, vi } from "vitest";

type AuditRow = {
  seq: number;
  workspaceId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  at: Date;
  before: unknown;
  after: unknown;
  prevHash: string | null;
  hash: string;
};

// Shared in-memory stand-in for `gm_audit_event`. Declared via vi.hoisted so
// the mock factory below (which is hoisted above imports) can close over it.
const store = vi.hoisted(() => ({ rows: [] as AuditRow[] }));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          // verifyAuditChain reads the whole chain in seq order.
          orderBy: () => [...store.rows].sort((a, b) => a.seq - b.seq),
        }),
      }),
    }),
  },
}));

const { recordAuditEvent, verifyAuditChain } = await import(
  "../../../apps/api/src/correspondence/audit"
);

const WORKSPACE = "ws-1";

/**
 * Stand-in for the transaction `recordAuditEvent` writes through. Reads the
 * chain head and appends to the same store the mocked `db` reads back, so a
 * record → verify round-trip exercises both halves of the hash contract.
 */
const tx = {
  execute: async () => undefined,
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => {
            const sorted = [...store.rows].sort((a, b) => b.seq - a.seq);
            return sorted.length ? [sorted[0]] : [];
          },
        }),
      }),
    }),
  }),
  insert: () => ({
    values: async (values: Omit<AuditRow, "seq">) => {
      store.rows.push({ ...values, seq: store.rows.length + 1 });
    },
  }),
} as never;

function record(params: {
  entityId: string;
  action: string;
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  return recordAuditEvent(tx, {
    workspaceId: WORKSPACE,
    entityType: "letter",
    ...params,
  });
}

beforeEach(() => {
  store.rows = [];
});

describe("recordAuditEvent", () => {
  it("opens the chain with a null prevHash", async () => {
    const { prevHash, hash } = await record({
      entityId: "letter-1",
      action: "create",
    });
    expect(prevHash).toBeNull();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("links each event to the hash of the one before it", async () => {
    const first = await record({ entityId: "letter-1", action: "create" });
    const second = await record({ entityId: "letter-1", action: "status" });
    expect(second.prevHash).toBe(first.hash);
    expect(store.rows[1]?.prevHash).toBe(store.rows[0]?.hash);
  });

  it("normalizes a missing actor to null rather than dropping the field", async () => {
    await record({ entityId: "letter-1", action: "create" });
    expect(store.rows[0]?.actorId).toBeNull();
  });
});

describe("verifyAuditChain", () => {
  it("accepts an empty chain", async () => {
    expect(await verifyAuditChain(WORKSPACE)).toEqual({ ok: true, count: 0 });
  });

  it("accepts a chain it wrote itself", async () => {
    await record({ entityId: "letter-1", action: "create", after: { a: 1 } });
    await record({
      entityId: "letter-1",
      action: "status",
      before: { status: "captured" },
      after: { status: "registered" },
    });
    await record({ entityId: "letter-2", action: "create", actorId: "user-1" });

    expect(await verifyAuditChain(WORKSPACE)).toEqual({ ok: true, count: 3 });
  });

  it("still verifies when a payload's keys come back in a different order", async () => {
    // Postgres jsonb does not preserve key order, so a stored payload can read
    // back reordered. Canonicalization is what keeps the recomputed hash
    // stable — without it, verification would fail on untouched rows.
    await record({
      entityId: "letter-1",
      action: "update",
      after: { subject: "Notis", refNo: "SM/2026/00001", jilid: 2 },
    });
    const row = store.rows[0] as AuditRow;
    const original = row.after as Record<string, unknown>;
    row.after = Object.fromEntries(Object.entries(original).reverse());
    expect(Object.keys(row.after)).not.toEqual(Object.keys(original));

    expect(await verifyAuditChain(WORKSPACE)).toEqual({ ok: true, count: 1 });
  });

  it("verifies payloads carrying dates, which jsonb stores as ISO strings", async () => {
    // Regression guard: hashing a live Date but verifying against the stored
    // ISO string is what broke chain verification once already.
    await record({
      entityId: "letter-1",
      action: "status",
      after: { status: "closed", closedAt: new Date("2026-07-06T09:00:00Z") },
    });
    expect(store.rows[0]?.after).toEqual({
      status: "closed",
      closedAt: "2026-07-06T09:00:00.000Z",
    });

    expect(await verifyAuditChain(WORKSPACE)).toEqual({ ok: true, count: 1 });
  });

  it("detects a tampered payload and names the offending event", async () => {
    await record({ entityId: "letter-1", action: "create" });
    await record({
      entityId: "letter-1",
      action: "status",
      after: { status: "registered" },
    });
    await record({ entityId: "letter-1", action: "close" });

    (store.rows[1] as AuditRow).after = { status: "closed" };

    expect(await verifyAuditChain(WORKSPACE)).toEqual({
      ok: false,
      count: 3,
      brokenAtSeq: 2,
    });
  });

  it("detects a rewritten hash", async () => {
    await record({ entityId: "letter-1", action: "create" });
    await record({ entityId: "letter-1", action: "status" });
    (store.rows[1] as AuditRow).hash = "0".repeat(64);

    expect(await verifyAuditChain(WORKSPACE)).toMatchObject({
      ok: false,
      brokenAtSeq: 2,
    });
  });

  it("detects a backdated event", async () => {
    await record({ entityId: "letter-1", action: "create" });
    (store.rows[0] as AuditRow).at = new Date("2020-01-01T00:00:00Z");

    expect(await verifyAuditChain(WORKSPACE)).toMatchObject({
      ok: false,
      brokenAtSeq: 1,
    });
  });

  it("detects an excised event, because the survivors no longer link up", async () => {
    await record({ entityId: "letter-1", action: "create" });
    await record({ entityId: "letter-1", action: "status" });
    await record({ entityId: "letter-1", action: "close" });
    // Drop the middle event — the classic "make the inconvenient step vanish".
    store.rows = store.rows.filter((r) => r.seq !== 2);

    expect(await verifyAuditChain(WORKSPACE)).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
    });
  });
});
