import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  isActionMarker,
  validateImportRows,
} from "../../../apps/api/src/meeting/minute-item-import";

describe("IMPORT_COLUMNS", () => {
  it("is the exact contract, in order", () => {
    expect([...IMPORT_COLUMNS]).toEqual([
      "numbering",
      "topic",
      "details",
      "status",
      "action",
    ]);
  });
});

describe("isActionMarker", () => {
  it("accepts a slash with surrounding whitespace", () => {
    expect(isActionMarker("/")).toBe(true);
    expect(isActionMarker("  /  ")).toBe(true);
  });

  it("treats anything else as not-an-action rather than guessing", () => {
    // Deliberately conservative: inventing actions from "yes"/"x"/"true"
    // would create work nobody agreed to.
    for (const v of [
      "",
      "  ",
      "x",
      "X",
      "yes",
      "true",
      "1",
      "//",
      "\\",
      undefined,
    ])
      expect(isActionMarker(v)).toBe(false);
  });
});

describe("validateImportRows", () => {
  it("accepts a well-formed file and trims every field", () => {
    const { items, errors } = validateImportRows([
      {
        numbering: " 2.1.4 ",
        topic: " Budget ",
        details: " Discussed ",
        status: " Selesai ",
        action: "",
      },
    ]);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      {
        numbering: "2.1.4",
        topic: "Budget",
        details: "Discussed",
        status: "Selesai",
        isAction: false,
      },
    ]);
  });

  it("marks the rows carrying a slash as actions", () => {
    const { items } = validateImportRows([
      { topic: "a", action: "/" },
      { topic: "b", action: "" },
      { topic: "c", action: " / " },
    ]);
    expect(items.map((i) => i.isAction)).toEqual([true, false, true]);
  });

  it("requires a topic, reporting the spreadsheet's row number", () => {
    // Index 0 is row 2 in the file: row 1 is the header.
    const { errors } = validateImportRows([{ numbering: "1", topic: "   " }]);
    expect(errors).toEqual([{ row: 2, message: "topic is required" }]);
  });

  it("returns every problem at once, not just the first", () => {
    // A caller fixing twenty rows one round-trip at a time gives up.
    const { errors } = validateImportRows([
      { topic: "" },
      { topic: "ok" },
      { topic: "" },
    ]);
    expect(errors.map((e) => e.row)).toEqual([2, 4]);
  });

  it("rejects a numbering that repeats within the file, naming both rows", () => {
    const { errors } = validateImportRows([
      { numbering: "2.1", topic: "a" },
      { numbering: "2.1", topic: "b" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toContain("2.1");
  });

  it("allows repeated blank numbering, which cannot collide meaningfully", () => {
    const { errors, items } = validateImportRows([
      { topic: "a" },
      { topic: "b" },
    ]);
    expect(errors).toEqual([]);
    expect(items.map((i) => i.numbering)).toEqual([null, null]);
  });

  it("keeps status as free text rather than an enum", () => {
    // Malay governance terms vary by body; an enum would reject a legitimate
    // minute.
    const { errors, items } = validateImportRows([
      { topic: "a", status: "Dalam tindakan" },
      { topic: "b", status: "Makluman" },
    ]);
    expect(errors).toEqual([]);
    expect(items.map((i) => i.status)).toEqual(["Dalam tindakan", "Makluman"]);
  });

  it("nulls empty optional fields rather than storing empty strings", () => {
    const { items } = validateImportRows([
      { topic: "a", details: "", status: "  " },
    ]);
    expect(items[0].details).toBeNull();
    expect(items[0].status).toBeNull();
    expect(items[0].numbering).toBeNull();
  });

  it("rejects an empty file", () => {
    const { errors } = validateImportRows([]);
    expect(errors).toEqual([{ row: 1, message: "The file contains no rows" }]);
  });
});
