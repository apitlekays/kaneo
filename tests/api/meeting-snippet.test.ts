import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  buildSnippets,
} from "../../apps/api/src/meeting/snippet";

describe("buildSnippet", () => {
  it("centres the window on the match and ellipsises both sides", () => {
    const text = `${"a".repeat(200)} quorum ${"b".repeat(200)}`;
    const s = buildSnippet(text, "quorum", 20) as string;
    expect(s).toContain("quorum");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });

  it("does not ellipsise a side it did not truncate", () => {
    const s = buildSnippet("quorum was reached", "quorum", 40) as string;
    expect(s).toBe("quorum was reached");
  });

  it("matches case-insensitively but returns the original casing", () => {
    const s = buildSnippet("The QUORUM was reached", "quorum", 40) as string;
    expect(s).toContain("QUORUM");
  });

  it("returns null when the term is absent, so the caller can omit the hit", () => {
    expect(buildSnippet("nothing relevant here", "quorum", 40)).toBeNull();
  });

  it("treats regex metacharacters in the term as literals", () => {
    // A term of "." must not match the first character of everything.
    expect(buildSnippet("abc", ".", 10)).toBeNull();
    expect(buildSnippet("a.c", ".", 10)).toBe("a.c");
  });

  it("collapses newlines so a snippet stays one line in the UI", () => {
    const s = buildSnippet(
      "minutes\n\n\tquorum\nreached",
      "quorum",
      40,
    ) as string;
    expect(s).not.toMatch(/[\n\t]/);
  });

  it("never returns more than the window plus the term", () => {
    const text = "x".repeat(5000);
    const s = buildSnippet(`${text}quorum${text}`, "quorum", 30) as string;
    // 30 either side + the term + two ellipses.
    expect(s.length).toBeLessThanOrEqual(30 * 2 + "quorum".length + 2);
  });
});

describe("buildSnippets", () => {
  it("returns one excerpt per separate occurrence, up to the cap", () => {
    const text = `quorum ${"x ".repeat(200)} quorum ${"y ".repeat(200)} quorum ${"z ".repeat(200)} quorum`;
    expect(buildSnippets(text, "quorum", 3, 20)).toHaveLength(3);
    expect(buildSnippets(text, "quorum", 2, 20)).toHaveLength(2);
  });

  it("skips occurrences already inside an earlier excerpt", () => {
    const s = buildSnippets("quorum and quorum again", "quorum", 3, 40);
    expect(s).toEqual(["quorum and quorum again"]);
  });

  it("returns nothing for an absent or empty term", () => {
    expect(buildSnippets("no match here", "quorum")).toEqual([]);
    expect(buildSnippets("anything", "  ")).toEqual([]);
  });
});
