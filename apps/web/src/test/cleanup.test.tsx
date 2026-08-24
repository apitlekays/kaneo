import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Guards the global `afterEach(cleanup)` registered in `./setup.ts`.
 *
 * Testing Library only auto-unmounts when `afterEach` is a global, and this
 * project deliberately does not set `globals: true`. If that registration is
 * ever dropped, the first test's DOM survives into the second, `getByText`
 * matches two nodes, and it throws "found multiple elements" — so the second
 * test here fails loudly rather than the leak going unnoticed until it
 * corrupts some unrelated suite.
 */
function Marker() {
  return <p>cleanup marker</p>;
}

describe("global DOM cleanup between tests", () => {
  it("renders the marker once", () => {
    render(<Marker />);
    expect(screen.getByText("cleanup marker")).toBeInTheDocument();
  });

  it("still finds exactly one marker after a previous test rendered it", () => {
    render(<Marker />);
    // getByText throws if the previous test's copy is still mounted.
    expect(screen.getByText("cleanup marker")).toBeInTheDocument();
    expect(screen.getAllByText("cleanup marker")).toHaveLength(1);
  });
});
