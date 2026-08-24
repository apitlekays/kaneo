import { describe, expect, it } from "vitest";
import { nextRoleForGlobalAdmin } from "../../../apps/api/src/workspace-access/global-admin-rules";

describe("nextRoleForGlobalAdmin", () => {
  it("promotes a member and remembers what they were", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "manager",
        previousRole: null,
        enabled: true,
      }),
    ).toEqual({ role: "global-admin", previousRole: "manager" });
  });

  it("restores the remembered role on demotion", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "global-admin",
        previousRole: "manager",
        enabled: false,
      }),
    ).toEqual({ role: "manager", previousRole: null });
  });

  it("falls back to member when nothing was remembered", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "global-admin",
        previousRole: null,
        enabled: false,
      }),
    ).toEqual({ role: "member", previousRole: null });
  });

  it("is a no-op when promoting someone already promoted", () => {
    // The bug this exists to prevent: without it, previousRole becomes
    // "global-admin" and the member can never be demoted back to anything.
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "global-admin",
        previousRole: "manager",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("is a no-op when demoting someone who is not a global admin", () => {
    expect(
      nextRoleForGlobalAdmin({
        currentRole: "member",
        previousRole: null,
        enabled: false,
      }),
    ).toBeNull();
  });
});
