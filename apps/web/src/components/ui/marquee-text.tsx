"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Reveal speed, in pixels per second. The user asked for "considerably
 * fast", and a fixed DURATION would be wrong: a title twice as long would
 * scroll twice as fast and be half as readable. Scaling the duration by the
 * distance instead means every title reveals at the same reading speed
 * regardless of length.
 */
const PIXELS_PER_SECOND = 110;

/**
 * Text that is clipped to its column at rest and scrolls sideways on hover
 * to reveal the rest, then returns.
 *
 * Why not `text-overflow: ellipsis`: ellipsis only renders on the direct
 * text of the clipping box, and the reveal needs an inner element to
 * translate — the two cannot coexist on one element. So the overflow is
 * signalled with a fade at the right edge, which has the advantage of
 * pointing in the direction the text will travel.
 *
 * The full string is always in the DOM and always on `title`, so nothing
 * here hides content from a screen reader, from Cmd-F, or from a user who
 * never hovers.
 *
 * **Put the width constraint on THIS component, not on the table cell.**
 * Tables default to `table-layout: auto`, which sizes a column to its
 * content and ignores `max-width` on the `<td>` — the column would still
 * grow and the table would still scroll sideways, which is the entire
 * problem this exists to solve. A `max-width` on this block child does cap
 * the cell's max-content contribution, so the column stops growing.
 */
export function MarqueeText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const viewportRef = React.useRef<HTMLSpanElement>(null);
  const innerRef = React.useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = React.useState(0);
  const [seconds, setSeconds] = React.useState(0);

  const reveal = React.useCallback(() => {
    const viewport = viewportRef.current;
    const inner = innerRef.current;
    if (!viewport || !inner) return;

    // Someone who has asked for less motion gets the `title` tooltip
    // instead. Checked at hover rather than at mount so a mid-session
    // change to the OS setting is honoured.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return;
    }

    const overflow = inner.scrollWidth - viewport.clientWidth;
    // Short subjects — the common case — must not twitch on hover.
    if (overflow <= 0) return;

    setOffset(overflow);
    setSeconds(overflow / PIXELS_PER_SECOND);
  }, []);

  const rest = React.useCallback(() => setOffset(0), []);

  return (
    // This span is presentational, not a control. It has no activation, no
    // state a user could miss, and nothing behind it: the full text is in
    // the DOM and on `title` whether or not anyone ever points at it. The
    // hover scroll is decoration over content that is already available.
    //
    // The rule is right in general — it catches click handlers stranded on
    // divs where keyboard users cannot reach them — but the fix it implies
    // here would be to bolt on an ARIA role this element does not have, or
    // a tabIndex that puts a non-control into the tab order of a table with
    // hundreds of rows. Both are worse for the people the rule protects.
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational hover reveal, see above
    <span
      ref={viewportRef}
      className={cn("block overflow-hidden whitespace-nowrap", className)}
      // The fade is the only cue that there is more text, so it must not
      // linger once the text has moved: at rest it marks the right edge, and
      // during the reveal it would otherwise wash out the end of the title.
      style={
        offset === 0
          ? {
              maskImage:
                "linear-gradient(to right, black calc(100% - 1.5rem), transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, black calc(100% - 1.5rem), transparent 100%)",
            }
          : undefined
      }
      // Hover only, and deliberately no focus/blur pair: a span with no
      // tabIndex can never receive focus, so those handlers would have been
      // dead code pretending to serve keyboard users. Keyboard and
      // screen-reader users get the whole string from `title` and from the
      // DOM text itself, neither of which depends on pointing at anything.
      onMouseEnter={reveal}
      onMouseLeave={rest}
      title={text}
      data-slot="marquee-text"
      // The fade above is pure presentation and jsdom implements no
      // mask-image, so the revealing state is also exposed here — both so a
      // test can assert it and so the state is inspectable in devtools.
      data-revealing={offset > 0 ? "true" : "false"}
    >
      <span
        ref={innerRef}
        className="inline-block"
        style={{
          transform: `translateX(-${offset}px)`,
          transitionProperty: "transform",
          transitionDuration: `${seconds}s`,
          transitionTimingFunction: "linear",
        }}
        data-slot="marquee-text-inner"
      >
        {text}
      </span>
    </span>
  );
}
