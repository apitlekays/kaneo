import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  MEMO_SHORTCODES,
  renderShortcodes,
} from "../../../apps/api/src/meeting/memorandum";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Quarterly Committee Meeting")).toBe(
      "Quarterly Committee Meeting",
    );
  });
});

describe("MEMO_SHORTCODES", () => {
  it("documents exactly the agreed vocabulary", () => {
    const tokens = MEMO_SHORTCODES.map((s) => s.token).sort();
    expect(tokens).toEqual(
      [
        "action_table",
        "meeting_date",
        "meeting_name",
        "notes",
        "numbering",
        "recipient_name",
        "status",
        "topic",
      ].sort(),
    );
  });
});

describe("renderShortcodes", () => {
  const values = {
    meeting_name: "Q3 Committee Meeting",
    meeting_date: "2026-09-10",
    numbering: "3.2",
    topic: "Budget approval",
    status: "pending",
    recipient_name: "Jane Doe",
    notes: "Please respond within 7 days.",
  };

  it("substitutes every documented token", () => {
    const html = renderShortcodes(
      "<p>{{meeting_name}} on {{meeting_date}}, item {{numbering}}: {{topic}} ({{status}}) for {{recipient_name}}. {{notes}}</p>",
      values,
    );

    expect(html).toBe(
      "<p>Q3 Committee Meeting on 2026-09-10, item 3.2: Budget approval (pending) for Jane Doe. Please respond within 7 days.</p>",
    );
  });

  it("leaves an unknown token untouched rather than blanking it", () => {
    const html = renderShortcodes("<p>{{not_a_real_token}}</p>", values);

    expect(html).toBe("<p>{{not_a_real_token}}</p>");
  });

  it("does not re-substitute a token that appears inside a substituted value", () => {
    const html = renderShortcodes("<p>{{meeting_name}}</p>", {
      ...values,
      meeting_name: "{{notes}}",
    });

    expect(html).toBe("<p>{{notes}}</p>");
  });

  it("HTML-escapes substituted values", () => {
    const html = renderShortcodes("<p>{{meeting_name}}</p>", {
      ...values,
      meeting_name: "<script>alert(1)</script>",
    });

    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("renders {{action_table}} as a one-row table with numbering, topic and status", () => {
    const html = renderShortcodes("{{action_table}}", values);

    expect(html).toContain("<table");
    expect(html).toContain("3.2");
    expect(html).toContain("Budget approval");
    expect(html).toContain("pending");
    // exactly one row of data - the three field values each appear once
    expect(html.match(/<td>/g)?.length).toBe(3);
  });

  it("HTML-escapes fields used inside {{action_table}}", () => {
    const html = renderShortcodes("{{action_table}}", {
      ...values,
      topic: "<b>bold</b>",
    });

    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("accepts whitespace inside the braces, e.g. {{ topic }}", () => {
    const html = renderShortcodes("<p>{{ topic }}</p>", values);

    expect(html).toBe("<p>Budget approval</p>");
  });

  it("does a single pass so a substituted value cannot smuggle in a second-pass replacement", () => {
    // meeting_name literally contains a valid token for a DIFFERENT field;
    // that inner token must not be expanded.
    const html = renderShortcodes("<p>{{meeting_name}} / {{topic}}</p>", {
      ...values,
      meeting_name: "{{topic}}",
    });

    expect(html).toBe("<p>{{topic}} / Budget approval</p>");
  });
});
