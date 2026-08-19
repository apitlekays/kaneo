import { describe, expect, it } from "vitest";
import { urgencyBadge } from "./urgency";

describe("urgencyBadge", () => {
  it("renders nothing for a normal letter", () => {
    // A badge on every row would stop the urgent ones standing out.
    expect(urgencyBadge("normal")).toBeNull();
  });

  it("renders a badge for an urgent letter", () => {
    expect(urgencyBadge("urgent")).toEqual({
      label: "Urgent",
      variant: "destructive",
    });
  });

  it("treats an unknown value as normal rather than guessing", () => {
    expect(urgencyBadge("")).toBeNull();
    expect(urgencyBadge("critical")).toBeNull();
  });
});
