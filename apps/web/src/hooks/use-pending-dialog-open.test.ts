import { describe, expect, it } from "vitest";
import { isIdleForDialog, shouldAutoOpen } from "./use-pending-dialog-open";

describe("shouldAutoOpen", () => {
  const base = {
    hasPending: true,
    isIdle: true,
    alreadyOpen: false,
    dismissed: false,
  };

  it("opens when work is pending and the user is idle", () => {
    expect(shouldAutoOpen(base)).toBe(true);
  });

  it("stays shut while the user is busy", () => {
    expect(shouldAutoOpen({ ...base, isIdle: false })).toBe(false);
  });

  it("stays shut when nothing is pending", () => {
    expect(shouldAutoOpen({ ...base, hasPending: false })).toBe(false);
  });

  it("does not reopen what the user dismissed", () => {
    expect(shouldAutoOpen({ ...base, dismissed: true })).toBe(false);
  });

  it("does not fight a dialog that is already open", () => {
    expect(shouldAutoOpen({ ...base, alreadyOpen: true })).toBe(false);
  });
});

describe("isIdleForDialog", () => {
  it("is idle when nothing has focus", () => {
    expect(isIdleForDialog(null)).toBe(true);
  });

  it("is busy while focus sits in a text input", () => {
    const input = document.createElement("input");
    expect(isIdleForDialog(input)).toBe(false);
  });

  it("is busy while focus sits in a textarea", () => {
    expect(isIdleForDialog(document.createElement("textarea"))).toBe(false);
  });

  it("is busy inside a contenteditable region", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isIdleForDialog(div)).toBe(false);
  });

  it("is idle when focus is on an ordinary button", () => {
    expect(isIdleForDialog(document.createElement("button"))).toBe(true);
  });
});
