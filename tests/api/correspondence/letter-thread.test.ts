import { describe, expect, it } from "vitest";
import { walkThread } from "../../../apps/api/src/correspondence/letter-thread";

const edge = (from: string, to: string) => ({
  fromLetterId: from,
  toLetterId: to,
});

describe("walkThread", () => {
  it("returns just the seed when it has no links", () => {
    expect(walkThread("a", []).ids).toEqual(["a"]);
  });

  it("follows a link forwards", () => {
    expect(walkThread("a", [edge("a", "b")]).ids.sort()).toEqual(["a", "b"]);
  });

  it("follows a link backwards, so either end returns the same thread", () => {
    // B was recorded as a reply to A. Opening A must still find B.
    expect(walkThread("a", [edge("b", "a")]).ids.sort()).toEqual(["a", "b"]);
  });

  it("walks a chain transitively", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    expect(walkThread("c", edges).ids.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("terminates on a cycle", () => {
    // Two letters referencing each other would loop forever without a
    // visited set. This test hangs rather than fails if that is missing.
    const edges = [edge("a", "b"), edge("b", "a")];
    expect(walkThread("a", edges).ids.sort()).toEqual(["a", "b"]);
  });

  it("terminates on a self-link", () => {
    expect(walkThread("a", [edge("a", "a")]).ids).toEqual(["a"]);
  });

  it("stops at the cap and says it truncated", () => {
    const edges = Array.from({ length: 200 }, (_, i) =>
      edge(`l${i}`, `l${i + 1}`),
    );
    const result = walkThread("l0", edges, 10);
    expect(result.ids).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("does not claim truncation when the thread fits", () => {
    expect(walkThread("a", [edge("a", "b")], 10).truncated).toBe(false);
  });

  it("ignores edges belonging to unrelated letters", () => {
    const edges = [edge("a", "b"), edge("x", "y")];
    expect(walkThread("a", edges).ids.sort()).toEqual(["a", "b"]);
  });
});
