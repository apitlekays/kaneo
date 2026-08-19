import { describe, expect, it } from "vitest";
import {
  decodeLetterDecisionId,
  encodeLetterDecisionId,
} from "../../../apps/api/src/pending-decision/providers/correspondence";

describe("letter decision id codec", () => {
  it("round-trips a letter and assignment id", () => {
    const encoded = encodeLetterDecisionId("ltr_abc", "asg_def");
    expect(decodeLetterDecisionId(encoded)).toEqual({
      letterId: "ltr_abc",
      assignmentId: "asg_def",
    });
  });

  it("rejects an id with no separator", () => {
    expect(() => decodeLetterDecisionId("ltr_abc")).toThrow();
  });

  it("rejects an id with an empty half", () => {
    expect(() => decodeLetterDecisionId("ltr_abc:")).toThrow();
    expect(() => decodeLetterDecisionId(":asg_def")).toThrow();
  });
});
