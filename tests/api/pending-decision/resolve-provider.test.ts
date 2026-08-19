import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../../apps/api/src/pending-decision/index";
import type { PendingDecisionProvider } from "../../../apps/api/src/pending-decision/types";

const stub = (source: string): PendingDecisionProvider => ({
  source,
  list: async () => [],
  decide: async () => {},
});

describe("resolveProvider", () => {
  it("finds a registered provider by source", () => {
    const alpha = stub("alpha");
    expect(resolveProvider([alpha, stub("beta")], "alpha")).toBe(alpha);
  });

  it("throws 404 for an unknown source", () => {
    expect(() => resolveProvider([stub("alpha")], "ghost")).toThrow(
      /Unknown pending-decision source/,
    );
  });
});
