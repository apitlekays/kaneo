import { describe, expect, it } from "vitest";
import {
  buildMemorandumHtml,
  escapeHtml,
  MEMO_SHORTCODES,
  renderShortcodes,
  type ShortcodeValues,
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

describe("buildMemorandumHtml", () => {
  const values: ShortcodeValues = {
    meeting_name: "Q3 Committee Meeting",
    meeting_date: "2026-09-10",
    numbering: "3.2",
    topic: "Budget approval",
    status: "pending",
    recipient_name: "Jane Doe",
    notes: "Please respond within 7 days.",
  };

  // Copied character-for-character from
  // docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md,
  // section "Exact email content required", with the bracketed placeholders
  // swapped for the matching shortcodes.
  const bodyMarkdown =
    "Dengan hormatnya, sekretariat pengurusan mesyuarat Wisma MAPIM Malaysia menjemput {{recipient_name}} untuk memberikan maklumbalas berkaitan cabutan minit {{meeting_name}} yang diadakan pada {{meeting_date}} yang lalu.";

  const ENDING_TEXT =
    "Mohon jasa baik pihak tuan untuk memberikan maklumbalas terus kepada pihak sekretariat melalui emel governance@mapim.org. Segala usaha tuan kami dahului dengan ribuan terima kasih. Moga semua khidmat Ummah yang dikerjakan mendapat redhaNya dan dipermudahkan segala urusan. Terima kasih.";

  const SIGNATURE_LINE_1 = "Sekretariat Pengurusan Mesyuarat";
  const SIGNATURE_LINE_2 = "Wisma MAPIM Malaysia";
  const SIGNATURE_DISCLAIMER =
    "//Emel ini dihantar secara automatik oleh sistem MAPIMCore.";

  it("formats the subject exactly as 'Memorandum Tindakan bagi <name> - <numbering>'", async () => {
    const { subject } = await buildMemorandumHtml({ values, bodyMarkdown });

    expect(subject).toBe("Memorandum Tindakan bagi Q3 Committee Meeting - 3.2");
  });

  // `minuteItemId` is optional on an action and `meeting_minute_item.numbering`
  // is itself nullable, so `numbering` arrives empty for any action created by
  // hand rather than by the CSV import. The separator must not survive on its
  // own: the outbound subject line and the stored audit record both read
  // "Memorandum Tindakan bagi Q3 Committee Meeting - " otherwise.
  it("drops the separator when the action has no numbering", async () => {
    const { subject } = await buildMemorandumHtml({
      values: { ...values, numbering: "" },
      bodyMarkdown,
    });

    expect(subject).toBe("Memorandum Tindakan bagi Q3 Committee Meeting");
    expect(subject).not.toMatch(/-\s*$/);
  });

  it("renders the greeting/body copy verbatim, with shortcodes substituted", async () => {
    const { html } = await buildMemorandumHtml({ values, bodyMarkdown });

    expect(html).toContain(
      "Dengan hormatnya, sekretariat pengurusan mesyuarat Wisma MAPIM Malaysia menjemput Jane Doe untuk memberikan maklumbalas berkaitan cabutan minit Q3 Committee Meeting yang diadakan pada 2026-09-10 yang lalu.",
    );
  });

  it("renders the ending copy verbatim", async () => {
    const { html } = await buildMemorandumHtml({ values, bodyMarkdown });

    expect(html).toContain(ENDING_TEXT);
  });

  it("renders the full signature block verbatim", async () => {
    const { html } = await buildMemorandumHtml({ values, bodyMarkdown });

    expect(html).toContain(SIGNATURE_LINE_1);
    expect(html).toContain(SIGNATURE_LINE_2);
    expect(html).toContain(SIGNATURE_DISCLAIMER);
  });

  it("styles the signature's last line italic and grey", async () => {
    const { html } = await buildMemorandumHtml({ values, bodyMarkdown });

    const disclaimerIndex = html.indexOf(SIGNATURE_DISCLAIMER);
    expect(disclaimerIndex).toBeGreaterThan(-1);

    // Walk back to the nearest opening tag carrying this text and assert it
    // is styled italic + grey (react-email inlines styles onto the element).
    const tagStart = html.lastIndexOf("<", disclaimerIndex);
    const tagEnd = html.indexOf(">", tagStart);
    const openingTag = html.slice(tagStart, tagEnd + 1);

    expect(openingTag).toMatch(/font-style:\s*italic/);
    expect(openingTag).toMatch(/color:\s*#[0-9a-fA-F]{3,6}/);
  });

  it("renders the one-row action table with numbering, topic and status", async () => {
    const { html } = await buildMemorandumHtml({ values, bodyMarkdown });

    expect(html).toContain("<table");
    expect(html).toContain("3.2");
    expect(html).toContain("Budget approval");
    expect(html).toContain("pending");
  });

  it("escapes a <script> typed directly into the author's Markdown", async () => {
    const { html } = await buildMemorandumHtml({
      values,
      bodyMarkdown: "Note: <script>alert(1)</script> please review.",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes a <script> smuggled in via a substituted shortcode value", async () => {
    const { html } = await buildMemorandumHtml({
      values: { ...values, recipient_name: "<script>alert(1)</script>" },
      bodyMarkdown: "Kepada {{recipient_name}},",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders Markdown bold, list and blockquote formatting", async () => {
    const { html } = await buildMemorandumHtml({
      values,
      bodyMarkdown:
        "This is **important**.\n\n- first item\n- second item\n\n> a quoted remark",
    });

    expect(html).toContain("<strong>important</strong>");
    expect(html).toContain("<li>first item</li>");
    expect(html).toContain("<li>second item</li>");
    expect(html).toContain("<blockquote");
    expect(html).toContain("a quoted remark");
  });

  it("never needs finished HTML from the caller — only Markdown and values", async () => {
    // A caller that (incorrectly) sends raw HTML gets it neutralised like
    // any other text, not rendered as markup.
    const { html } = await buildMemorandumHtml({
      values,
      bodyMarkdown: "<b>not markdown-escaped bold</b>",
    });

    expect(html).not.toContain("<b>not markdown-escaped bold</b>");
    expect(html).toContain("&lt;b&gt;not markdown-escaped bold&lt;/b&gt;");
  });
});
