import { describe, expect, it } from "vitest";
import {
  allocateNumber,
  type NumberScheme,
  previewNumber,
} from "../../../apps/api/src/correspondence/numbering";

/**
 * Minimal stand-in for the drizzle insert chain `allocateNumber` drives. It
 * records the values it was handed and replays a counter value as if the
 * upsert had bumped the sequence row.
 */
function fakeTx(lastValue: number | undefined = 1) {
  const captured: { values?: Record<string, unknown> } = {};
  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.values = values;
        return {
          onConflictDoUpdate: () => ({
            returning: async () =>
              lastValue === undefined ? [] : [{ lastValue }],
          }),
        };
      },
    }),
  };
  return { tx: tx as never, captured };
}

const scheme = (overrides: Partial<NumberScheme> = {}): NumberScheme => ({
  id: "scheme-1",
  workspaceId: "ws-1",
  direction: "in",
  letterType: "external",
  format: {},
  resetPolicy: "yearly",
  ...overrides,
});

describe("previewNumber", () => {
  it("falls back to the default pattern and 5-digit padding", () => {
    expect(
      previewNumber({
        direction: "in",
        letterType: "external",
        format: {},
        resetPolicy: "never",
      }),
    ).toBe("SM/ALL/00001");
  });

  it("maps direction to its register token", () => {
    const base = {
      letterType: "external",
      format: {},
      resetPolicy: "never" as const,
    };
    expect(previewNumber({ ...base, direction: "in" })).toContain("SM/");
    expect(previewNumber({ ...base, direction: "out" })).toContain("SK/");
  });

  it("substitutes every supported token", () => {
    expect(
      previewNumber({
        direction: "out",
        letterType: "circular",
        format: { pattern: "MAPIM/{type}/{direction}/{year}/{serial}" },
        resetPolicy: "never",
      }),
    ).toBe("MAPIM/PKL/SK/ALL/00001");
  });

  it("honours a configured serial width", () => {
    expect(
      previewNumber({
        direction: "in",
        letterType: "memo",
        format: { pattern: "{type}-{serial}", serialPad: 3 },
        resetPolicy: "never",
      }),
    ).toBe("MEMO-001");
  });

  it("ignores a non-positive serial width and keeps the 5-digit default", () => {
    expect(
      previewNumber({
        direction: "in",
        letterType: "memo",
        format: { pattern: "{serial}", serialPad: 0 },
        resetPolicy: "never",
      }),
    ).toBe("00001");
  });

  it("renders the current year for a yearly-reset scheme", () => {
    expect(
      previewNumber({
        direction: "in",
        letterType: "external",
        format: { pattern: "{year}" },
        resetPolicy: "yearly",
      }),
    ).toBe(String(new Date().getUTCFullYear()));
  });

  // Documents current behaviour: `memo` and `circular` render as the register
  // codes MEMO/PKL, but `external` renders as the literal lowercase word. See
  // the note raised with this change — this may want its own code.
  it("renders the external letter type as a lowercase word, unlike MEMO/PKL", () => {
    const base = { direction: "in", format: {}, resetPolicy: "never" as const };
    expect(
      previewNumber({
        ...base,
        letterType: "external",
        format: { pattern: "{type}" },
      }),
    ).toBe("external");
    expect(
      previewNumber({
        ...base,
        letterType: "memo",
        format: { pattern: "{type}" },
      }),
    ).toBe("MEMO");
  });

  it("passes an unrecognised direction or type through unchanged", () => {
    expect(
      previewNumber({
        direction: "internal",
        letterType: "notice",
        format: { pattern: "{direction}/{type}" },
        resetPolicy: "never",
      }),
    ).toBe("internal/notice");
  });

  it("renders {dept} as empty — departmental numbering is not wired up yet", () => {
    expect(
      previewNumber({
        direction: "in",
        letterType: "external",
        format: { pattern: "A/{dept}/B" },
        resetPolicy: "never",
      }),
    ).toBe("A//B");
  });
});

describe("allocateNumber", () => {
  it("renders the serial the sequence row returned", async () => {
    const { tx } = fakeTx(42);
    expect(
      await allocateNumber(
        tx,
        scheme({ format: { pattern: "{direction}/{year}/{serial}" } }),
        new Date("2026-07-06T00:00:00.000Z"),
      ),
    ).toBe("SM/2026/00042");
  });

  it("keys the counter by UTC year when the scheme resets yearly", async () => {
    const { tx, captured } = fakeTx(1);
    await allocateNumber(tx, scheme(), new Date("2026-07-06T00:00:00.000Z"));
    expect(captured.values?.periodKey).toBe("2026");
  });

  it("derives the period from UTC, not the host timezone", async () => {
    // A machine in UTC+8 sees 2026-01-01 08:30 local here; the register must
    // still allocate against 2025 so the year's numbering stays gap-free.
    const { tx, captured } = fakeTx(1);
    await allocateNumber(tx, scheme(), new Date("2025-12-31T23:30:00.000Z"));
    expect(captured.values?.periodKey).toBe("2025");
  });

  it("keys a never-reset scheme to a single perpetual period", async () => {
    const { tx, captured } = fakeTx(1);
    await allocateNumber(
      tx,
      scheme({ resetPolicy: "never" }),
      new Date("2026-07-06T00:00:00.000Z"),
    );
    expect(captured.values?.periodKey).toBe("ALL");
  });

  it("scopes the sequence row to the workspace and scheme", async () => {
    const { tx, captured } = fakeTx(1);
    await allocateNumber(
      tx,
      scheme({ id: "scheme-9", workspaceId: "ws-9" }),
      new Date("2026-07-06T00:00:00.000Z"),
    );
    expect(captured.values?.workspaceId).toBe("ws-9");
    expect(captured.values?.schemeId).toBe("scheme-9");
    // Seeds at 1 so the first allocation of a period is serial 1, not 0.
    expect(captured.values?.lastValue).toBe(1);
  });

  it("falls back to serial 1 if the upsert returns no row", async () => {
    const { tx } = fakeTx(undefined);
    expect(
      await allocateNumber(
        tx,
        scheme({ format: { pattern: "{serial}" }, resetPolicy: "never" }),
        new Date("2026-07-06T00:00:00.000Z"),
      ),
    ).toBe("00001");
  });
});
