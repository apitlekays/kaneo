import { describe, expect, it } from "vitest";
import { letterReference, referenceHeader } from "./letter-reference";

describe("letterReference", () => {
  it("prefers the external reference on an incoming letter", () => {
    expect(
      letterReference({
        direction: "in",
        refNo: "MAPIM/2026/0114",
        externalRefNo: "JAKIM/5/2026",
      }),
    ).toBe("JAKIM/5/2026");
  });

  it("falls back to the internal reference when an incoming letter has no ERN", () => {
    expect(
      letterReference({
        direction: "in",
        refNo: "MAPIM/2026/0114",
        externalRefNo: null,
      }),
    ).toBe("MAPIM/2026/0114");
  });

  it("shows a dash when an incoming letter has neither", () => {
    expect(
      letterReference({ direction: "in", refNo: null, externalRefNo: null }),
    ).toBe("—");
  });

  it("always uses the internal reference on an outgoing letter", () => {
    expect(
      letterReference({
        direction: "out",
        refNo: "MAPIM/2026/0114",
        externalRefNo: "SHOULD/NOT/APPEAR",
      }),
    ).toBe("MAPIM/2026/0114");
  });

  it("shows a dash for an outgoing letter with no reference yet", () => {
    expect(
      letterReference({ direction: "out", refNo: null, externalRefNo: "X/1" }),
    ).toBe("—");
  });
});

describe("referenceHeader", () => {
  it("names the column for what it holds", () => {
    expect(referenceHeader("in")).toBe("ERN");
    expect(referenceHeader("out")).toBe("Ref No.");
  });
});
