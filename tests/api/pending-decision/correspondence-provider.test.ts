import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  correspondenceProvider,
  decodeLetterDecisionId,
  encodeLetterDecisionId,
  toPendingItem,
} from "../../../apps/api/src/pending-decision/providers/correspondence";

// `decideLetterAssignment` is the only thing in this provider that touches
// the database. Mocking it (and asserting on the mock's call count below)
// lets the reason-guard tests prove the guard runs *before* any database
// call, without needing a real database, and without a broken guard order
// silently passing because the mock happened to resolve anyway.
const decideLetterAssignmentMock = vi.hoisted(() => vi.fn());

vi.mock("../../../apps/api/src/correspondence/letters", () => ({
  decideLetterAssignment: decideLetterAssignmentMock,
}));

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

describe("toPendingItem urgency badge", () => {
  const baseRow = {
    id: "asg_def",
    letterId: "ltr_abc",
    action: "inspect",
    note: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    refNo: "REF-1",
    subject: "Test subject",
  };

  it("flags an urgent letter with a badge and leaves a normal one bare", () => {
    const urgentItem = toPendingItem({ ...baseRow, urgency: "urgent" });
    expect(urgentItem.badges).toEqual([{ label: "Urgent", tone: "urgent" }]);

    const normalItem = toPendingItem({ ...baseRow, urgency: "normal" });
    expect(normalItem.badges ?? []).toEqual([]);
  });
});

describe("correspondenceProvider.decide reason guard", () => {
  const baseArgs = {
    userId: "user-1",
    workspaceId: "ws-1",
    id: encodeLetterDecisionId("ltr_abc", "asg_def"),
    ip: null,
  };

  beforeEach(() => {
    decideLetterAssignmentMock.mockReset();
    decideLetterAssignmentMock.mockResolvedValue(undefined);
  });

  it("rejects a rejection with a null reason with a 400, before any database call", async () => {
    let caught: unknown;
    try {
      await correspondenceProvider.decide({
        ...baseArgs,
        decision: "rejected",
        reason: null,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HTTPException);
    expect((caught as HTTPException).status).toBe(400);
    expect((caught as HTTPException).message).toMatch(
      /rejection must carry a reason/,
    );
    // The guard must short-circuit before decideLetterAssignment (the only
    // database-touching call this provider makes) is ever reached.
    expect(decideLetterAssignmentMock).not.toHaveBeenCalled();
  });

  it("rejects a rejection with a whitespace-only reason with a 400", async () => {
    let caught: unknown;
    try {
      await correspondenceProvider.decide({
        ...baseArgs,
        decision: "rejected",
        reason: "   ",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HTTPException);
    expect((caught as HTTPException).status).toBe(400);
    expect(decideLetterAssignmentMock).not.toHaveBeenCalled();
  });

  it("does not throw for an acceptance with a null reason", async () => {
    await expect(
      correspondenceProvider.decide({
        ...baseArgs,
        decision: "accepted",
        reason: null,
      }),
    ).resolves.toBeUndefined();
    expect(decideLetterAssignmentMock).toHaveBeenCalledTimes(1);
  });

  // The old `/letters/:id/assignments/:aid/accept` route hard-codes `null`
  // for the accept reason, so acceptance can never carry a note into the
  // audit chain (`after.reason` is canonicalized and SHA-256'd into the hash
  // chain). This provider must not let actor-supplied text slip in on the
  // path the old route blocks.
  it("forwards a null reason to decideLetterAssignment on accept, even when the caller supplied one", async () => {
    await correspondenceProvider.decide({
      ...baseArgs,
      decision: "accepted",
      reason: "Looks good, proceeding",
    });
    expect(decideLetterAssignmentMock).toHaveBeenCalledTimes(1);
    expect(decideLetterAssignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null }),
    );
  });

  // The two reject tests above both throw at the guard before
  // decideLetterAssignment is ever reached, and no other test exercises a
  // *successful* reject through the provider. Without this, the ternary
  // could be flattened to `reason: null` and every existing test would stay
  // green — silently dropping rejection reasons from a hash-chained legal
  // register. This is the regression net for that branch.
  it("forwards the reason intact to decideLetterAssignment on a successful reject", async () => {
    await correspondenceProvider.decide({
      ...baseArgs,
      decision: "rejected",
      reason: "Wrong department",
    });
    expect(decideLetterAssignmentMock).toHaveBeenCalledTimes(1);
    expect(decideLetterAssignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "rejected",
        reason: "Wrong department",
      }),
    );
  });
});
