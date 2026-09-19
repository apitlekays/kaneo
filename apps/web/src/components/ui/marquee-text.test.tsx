import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarqueeText } from "@/components/ui/marquee-text";

/**
 * jsdom performs no layout, so `scrollWidth` and `clientWidth` are both 0 on
 * every element — which would make every test here trivially "not
 * overflowing" and prove nothing. These helpers stub the two measurements
 * the component actually reads, so overflow is something the test controls
 * rather than something jsdom decides.
 */
function measure({ inner, viewport }: { inner: number; viewport: number }) {
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockReturnValue(inner);
  const client = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(viewport);
  return () => {
    scroll.mockRestore();
    client.mockRestore();
  };
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function inner() {
  return document.querySelector(
    "[data-slot='marquee-text-inner']",
  ) as HTMLElement;
}

function viewport() {
  return document.querySelector("[data-slot='marquee-text']") as HTMLElement;
}

const LONG =
  "PERMOHONAN SUMBANGAN DAN SOKONGAN CSR BAGI PROGRAM JALINAN KOMUNITI GLOBAL KEPIMPINAN ANTARABANGSA DI NEW ZEALAND";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MarqueeText", () => {
  it("keeps the whole string in the DOM, so search and screen readers still find it", () => {
    // The column shows a slice; the content must not BE a slice. Truncating
    // the string itself would break Cmd-F and read wrong aloud.
    render(<MarqueeText text={LONG} />);
    expect(screen.getByText(LONG)).toBeInTheDocument();
  });

  it("exposes the full text as a title, which is the no-hover fallback", () => {
    render(<MarqueeText text={LONG} />);
    expect(viewport()).toHaveAttribute("title", LONG);
  });

  it("scrolls on hover by exactly the hidden distance", () => {
    const restore = measure({ inner: 700, viewport: 300 });
    render(<MarqueeText text={LONG} />);

    expect(inner().style.transform).toBe("translateX(-0px)");
    fireEvent.mouseEnter(viewport());

    // 700 - 300 = 400px hidden, so that is exactly how far it must travel:
    // less would leave the end unread, more would overshoot into blank space.
    expect(inner().style.transform).toBe("translateX(-400px)");
    restore();
  });

  it("scales duration with distance, so every title reveals at one reading speed", () => {
    const restore = measure({ inner: 700, viewport: 300 });
    render(<MarqueeText text={LONG} />);
    fireEvent.mouseEnter(viewport());

    // 400px at 110px/s. A fixed duration would make a longer title scroll
    // faster and be harder to read, which is the bug this pins.
    expect(inner().style.transitionDuration).toBe(`${400 / 110}s`);
    restore();
  });

  it("does not move a title that already fits", () => {
    // The common case. A short subject twitching on hover would be noise on
    // every row of the table.
    const restore = measure({ inner: 200, viewport: 300 });
    render(<MarqueeText text="Surat kuiri SPRM" />);

    fireEvent.mouseEnter(viewport());

    expect(inner().style.transform).toBe("translateX(-0px)");
    restore();
  });

  it("returns to the start when the pointer leaves", () => {
    const restore = measure({ inner: 700, viewport: 300 });
    render(<MarqueeText text={LONG} />);

    fireEvent.mouseEnter(viewport());
    expect(inner().style.transform).toBe("translateX(-400px)");

    fireEvent.mouseLeave(viewport());
    expect(inner().style.transform).toBe("translateX(-0px)");
    restore();
  });

  it("stays still when the user has asked for reduced motion", () => {
    setReducedMotion(true);
    const restore = measure({ inner: 700, viewport: 300 });
    render(<MarqueeText text={LONG} />);

    fireEvent.mouseEnter(viewport());

    // No movement — the `title` tooltip is the reveal for these users.
    expect(inner().style.transform).toBe("translateX(-0px)");
    expect(viewport()).toHaveAttribute("title", LONG);
    restore();
  });

  it("marks itself as revealing only while scrolling", () => {
    // The right-edge fade is the cue that text is hidden, and it is dropped
    // during the reveal so it does not wash out the end of the very title it
    // is advertising. That fade is a mask-image, which jsdom does not
    // implement, so the same state is asserted through the attribute the
    // component exposes for exactly this reason.
    const restore = measure({ inner: 700, viewport: 300 });
    render(<MarqueeText text={LONG} />);

    expect(viewport()).toHaveAttribute("data-revealing", "false");

    fireEvent.mouseEnter(viewport());
    expect(viewport()).toHaveAttribute("data-revealing", "true");

    fireEvent.mouseLeave(viewport());
    expect(viewport()).toHaveAttribute("data-revealing", "false");
    restore();
  });
});
