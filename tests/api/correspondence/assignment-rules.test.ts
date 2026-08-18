import { describe, expect, it } from "vitest";
import {
  assertCanDecide,
  ownerAfterDecision,
} from "../../../apps/api/src/correspondence/assignment-rules";

const pending = { toUserId: "siti", fromUserId: "ahmad", status: "pending" };

describe("assertCanDecide", () => {
  it("lets the named recipient decide", () => {
    expect(() => assertCanDecide(pending, "siti")).not.toThrow();
  });

  it("refuses anyone who is not the named recipient", () => {
    expect(() => assertCanDecide(pending, "ahmad")).toThrowError(
      /only the assigned recipient/i,
    );
  });

  it("refuses a second decision on an already-decided assignment", () => {
    expect(() =>
      assertCanDecide({ ...pending, status: "accepted" }, "siti"),
    ).toThrowError(/already/i);
  });

  it("refuses a superseded assignment", () => {
    expect(() =>
      assertCanDecide({ ...pending, status: "superseded" }, "siti"),
    ).toThrowError(/already/i);
  });
});

describe("ownerAfterDecision", () => {
  it("hands the letter to the recipient on accept", () => {
    expect(ownerAfterDecision(pending, "accepted")).toBe("siti");
  });

  it("returns the letter to the sender on reject", () => {
    expect(ownerAfterDecision(pending, "rejected")).toBe("ahmad");
  });

  it("leaves the letter unowned when a rejected assignment has no sender", () => {
    // fromUserId is nullable: the sending user may have been deleted.
    expect(
      ownerAfterDecision({ toUserId: "siti", fromUserId: null }, "rejected"),
    ).toBeNull();
  });
});
