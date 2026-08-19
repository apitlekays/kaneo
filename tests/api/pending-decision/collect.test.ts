import { describe, expect, it } from "vitest";
import { collectPendingDecisions } from "../../../apps/api/src/pending-decision/collect";
import type {
  PendingDecisionItem,
  PendingDecisionProvider,
} from "../../../apps/api/src/pending-decision/types";

function item(
  source: string,
  id: string,
  createdAt: Date,
): PendingDecisionItem {
  return {
    source,
    id,
    title: id,
    subtitle: "",
    context: [],
    href: `/x/${id}`,
    createdAt,
    requiresReason: true,
  };
}

function provider(
  source: string,
  items: PendingDecisionItem[],
): PendingDecisionProvider {
  return {
    source,
    list: async () => items,
    decide: async () => {},
  };
}

describe("collectPendingDecisions", () => {
  it("merges every provider's items oldest first", async () => {
    const a = provider("alpha", [item("alpha", "a1", new Date("2026-03-02"))]);
    const b = provider("beta", [
      item("beta", "b1", new Date("2026-01-05")),
      item("beta", "b2", new Date("2026-05-01")),
    ]);

    const result = await collectPendingDecisions([a, b], "u1", "ws1");

    expect(result.items.map((i) => i.id)).toEqual(["b1", "a1", "b2"]);
    expect(result.failedSources).toEqual([]);
  });

  it("returns the healthy providers' items when one throws", async () => {
    const healthy = provider("alpha", [
      item("alpha", "a1", new Date("2026-03-02")),
    ]);
    const broken: PendingDecisionProvider = {
      source: "beta",
      list: async () => {
        throw new Error("database is on fire");
      },
      decide: async () => {},
    };

    const result = await collectPendingDecisions(
      [healthy, broken],
      "u1",
      "ws1",
    );

    expect(result.items.map((i) => i.id)).toEqual(["a1"]);
    expect(result.failedSources).toEqual(["beta"]);
  });

  it("passes the caller's user and workspace through to each provider", async () => {
    const seen: string[] = [];
    const spy: PendingDecisionProvider = {
      source: "alpha",
      list: async (userId, workspaceId) => {
        seen.push(`${userId}/${workspaceId}`);
        return [];
      },
      decide: async () => {},
    };

    await collectPendingDecisions([spy], "user-9", "ws-4");

    expect(seen).toEqual(["user-9/ws-4"]);
  });
});
