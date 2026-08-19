import { describe, expect, it } from "vitest";
import { pendingSources } from "./use-pending-actions";

describe("pendingSources", () => {
  it("names a source with work waiting", () => {
    expect(pendingSources({ correspondence: 3 })).toEqual(["correspondence"]);
  });

  it("names nothing when a source is empty", () => {
    expect(pendingSources({ correspondence: 0 })).toEqual([]);
  });

  it("ignores a negative or nonsense count rather than lighting the dot", () => {
    expect(pendingSources({ correspondence: -1 })).toEqual([]);
  });
});
