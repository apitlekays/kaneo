import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { letterUrgencySchema } from "../../../apps/api/src/correspondence/register-fields";

describe("letterUrgencySchema", () => {
  it("accepts the two urgency levels", () => {
    expect(v.parse(letterUrgencySchema, "urgent")).toBe("urgent");
    expect(v.parse(letterUrgencySchema, "normal")).toBe("normal");
  });

  it("rejects anything else", () => {
    expect(() => v.parse(letterUrgencySchema, "critical")).toThrow();
    expect(() => v.parse(letterUrgencySchema, "")).toThrow();
    expect(() => v.parse(letterUrgencySchema, "URGENT")).toThrow();
  });
});
