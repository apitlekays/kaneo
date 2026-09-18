import { describe, expect, it } from "vitest";
import { buildSnippet } from "../../apps/api/src/meeting/snippet";

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
