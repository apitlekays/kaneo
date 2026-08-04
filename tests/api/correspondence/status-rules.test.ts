import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  ASSIGNEE_STATUSES,
  assertNoOpenActions,
  assertStatusChangeAllowed,
  resolveClosedAt,
} from "../../../apps/api/src/correspondence/status-rules";

const ALL_STATUSES = [
  "captured",
  "registered",
  "classified",
  "assigned",
  "in-action",
  "awaiting-response",
  "closed",
  "archived",
] as const;

/** The thrown HTTPException status, or null if the call was allowed. */
function statusOf(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof HTTPException) return error.status;
    throw error;
  }
}

describe("assertStatusChangeAllowed", () => {
  it("lets a GM officer set any status in the lifecycle", () => {
    for (const status of ALL_STATUSES) {
      expect(
        statusOf(() =>
          assertStatusChangeAllowed({
            status,
            hasPageAccess: true,
            isCurrentAssignee: false,
          }),
        ),
      ).toBeNull();
    }
  });

  it("lets the Main User set the handling statuses on their own letter", () => {
    for (const status of ASSIGNEE_STATUSES) {
      expect(
        statusOf(() =>
          assertStatusChangeAllowed({
            status,
            hasPageAccess: false,
            isCurrentAssignee: true,
          }),
        ),
      ).toBeNull();
    }
  });

  it("blocks the Main User from registry operations", () => {
    // Registration, classification and archival are records-custodian acts —
    // letting the assignee self-serve these would break the register.
    const registryOps = ALL_STATUSES.filter(
      (s) =>
        !ASSIGNEE_STATUSES.includes(s as (typeof ASSIGNEE_STATUSES)[number]),
    );
    expect(registryOps.length).toBeGreaterThan(0);
    for (const status of registryOps) {
      expect(
        statusOf(() =>
          assertStatusChangeAllowed({
            status,
            hasPageAccess: false,
            isCurrentAssignee: true,
          }),
        ),
      ).toBe(403);
    }
  });

  it("blocks a workspace member who is neither GM officer nor Main User", () => {
    // e.g. a delegated action assignee, or a route recipient who is no longer
    // the current assignee — they may view, but not drive the lifecycle.
    for (const status of ALL_STATUSES) {
      expect(
        statusOf(() =>
          assertStatusChangeAllowed({
            status,
            hasPageAccess: false,
            isCurrentAssignee: false,
          }),
        ),
      ).toBe(403);
    }
  });
});

describe("assertNoOpenActions", () => {
  it("allows closing when every delegated action is done or cancelled", () => {
    expect(statusOf(() => assertNoOpenActions(0))).toBeNull();
  });

  it("rejects closing with 409 while delegated actions remain open", () => {
    expect(statusOf(() => assertNoOpenActions(2))).toBe(409);
  });

  it("names the outstanding count so the caller can surface it", () => {
    try {
      assertNoOpenActions(3);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as HTTPException).message).toContain("3");
    }
  });
});

describe("resolveClosedAt", () => {
  const now = new Date("2026-07-06T09:00:00.000Z");
  const earlier = new Date("2026-05-01T00:00:00.000Z");

  it("stamps the close date when a letter is first closed", () => {
    expect(
      resolveClosedAt({
        status: "closed",
        previousStatus: "in-action",
        previousClosedAt: null,
        now,
      }),
    ).toEqual(now);
  });

  it("keeps the original close date when closed is re-applied", () => {
    // The retention clock runs from closedAt — re-closing must not restart it.
    expect(
      resolveClosedAt({
        status: "closed",
        previousStatus: "closed",
        previousClosedAt: earlier,
        now,
      }),
    ).toEqual(earlier);
  });

  it("clears the close date when a closed letter is reopened", () => {
    expect(
      resolveClosedAt({
        status: "in-action",
        previousStatus: "closed",
        previousClosedAt: earlier,
        now,
      }),
    ).toBeNull();
  });

  it("leaves the close date untouched for transitions that are not closes", () => {
    expect(
      resolveClosedAt({
        status: "awaiting-response",
        previousStatus: "in-action",
        previousClosedAt: null,
        now,
      }),
    ).toBeNull();
  });
});
