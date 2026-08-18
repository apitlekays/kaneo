import { describe, expect, it } from "vitest";
import { attachmentAuditAction } from "../../../apps/api/src/correspondence/attachment-access";

describe("attachmentAuditAction", () => {
  it("records a plain fetch as a download", () => {
    expect(attachmentAuditAction({})).toBe("download");
  });

  it("records an inline preview distinctly from a download", () => {
    expect(attachmentAuditAction({ preview: "true" })).toBe("preview");
  });

  it("treats preview=false as a download", () => {
    expect(attachmentAuditAction({ preview: "false" })).toBe("download");
  });

  it("never leaves an access unrecorded", () => {
    // Both branches must name an action; a falsy return would drop the event.
    for (const preview of [undefined, "true", "false"] as const) {
      expect(attachmentAuditAction({ preview })).toBeTruthy();
    }
  });
});
