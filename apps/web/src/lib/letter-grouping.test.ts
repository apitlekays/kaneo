import { describe, expect, it } from "vitest";
import {
  groupLettersByYear,
  letterYearDate,
  nextSortDirection,
} from "./letter-grouping";

type Row = {
  id: string;
  receivedAt: string | null;
  letterDate: string | null;
  createdAt: string;
};

const row = (
  id: string,
  receivedAt: string | null,
  letterDate: string | null = null,
  createdAt = "2026-06-01T00:00:00.000Z",
): Row => ({ id, receivedAt, letterDate, createdAt });

describe("letterYearDate", () => {
  it("prefers the received date", () => {
    expect(
      letterYearDate(
        row("a", "2025-03-04T00:00:00.000Z", "2024-01-01T00:00:00.000Z"),
      ).getUTCFullYear(),
    ).toBe(2025);
  });

  it("falls back to the letter's own date", () => {
    expect(
      letterYearDate(
        row("a", null, "2024-01-01T00:00:00.000Z"),
      ).getUTCFullYear(),
    ).toBe(2024);
  });

  it("falls back to the created date last", () => {
    expect(letterYearDate(row("a", null, null)).getUTCFullYear()).toBe(2026);
  });
});

describe("groupLettersByYear", () => {
  const rows = [
    row("a", "2025-03-04T00:00:00.000Z"),
    row("b", "2026-01-09T00:00:00.000Z"),
    row("c", "2025-11-20T00:00:00.000Z"),
  ];

  it("groups newest year first and newest letter first by default", () => {
    const groups = groupLettersByYear(rows, letterYearDate, "desc");
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
    expect(groups[1].letters.map((l) => l.id)).toEqual(["c", "a"]);
  });

  it("flips both the group order and the order within a group", () => {
    const groups = groupLettersByYear(rows, letterYearDate, "asc");
    expect(groups.map((g) => g.year)).toEqual([2025, 2026]);
    expect(groups[0].letters.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupLettersByYear([], letterYearDate, "desc")).toEqual([]);
  });

  it("puts a backdated letter in its own year, not the year it was entered", () => {
    // The office registers historical correspondence; grouping on the entry
    // date would pile decades of letters under one heading.
    const backdated = [
      row("old", "2019-08-01T00:00:00.000Z", null, "2026-08-19T00:00:00.000Z"),
    ];
    expect(groupLettersByYear(backdated, letterYearDate, "desc")[0].year).toBe(
      2019,
    );
  });
});

describe("nextSortDirection", () => {
  it("toggles", () => {
    expect(nextSortDirection("desc")).toBe("asc");
    expect(nextSortDirection("asc")).toBe("desc");
  });
});
