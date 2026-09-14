/**
 * Shortcode renderer and memorandum email builder for the Meeting Minutes
 * "Configure -> send memorandum" feature.
 *
 * No database, no clock, no randomness — this module only turns an
 * author-edited Markdown template plus a bag of field values into the final
 * HTML that gets sent. It is deliberately dumb: the caller (the send route,
 * added later) is responsible for sourcing the values, and for making sure
 * it only ever hands this module Markdown, never HTML — see
 * `buildMemorandumHtml` below.
 */

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { marked } from "marked";
import { createElement } from "react";

export type MemoShortcode = {
  /** The token name, without the surrounding braces. */
  token: string;
  /** Human-readable description shown to the user in the Configure popup. */
  description: string;
};

/**
 * The documented shortcode vocabulary. This is also what the Configure
 * popup renders as the "available shortcodes" list, so keep the tokens and
 * their wording user-facing.
 *
 * `as const satisfies` (rather than a `: readonly MemoShortcode[]`
 * annotation) is deliberate: an explicit annotation would widen every
 * `token` to `string`, which would make `ShortcodeValues` below degrade to
 * `Record<string, string>` and silently accept any typo. Keeping the
 * literal types means `ShortcodeValues` is derived from this list, so a
 * token added here without a matching call-site update is a type error,
 * not a support question.
 */
export const MEMO_SHORTCODES = [
  { token: "meeting_name", description: "Name of the meeting" },
  { token: "meeting_date", description: "Date of the meeting" },
  { token: "numbering", description: "The action's numbering (e.g. 3.2)" },
  { token: "topic", description: "The action's topic" },
  { token: "status", description: "The action's current status" },
  {
    token: "recipient_name",
    description: "Name of the memorandum recipient",
  },
  {
    token: "action_table",
    description: "One-row table of the action's numbering, topic and status",
  },
  { token: "notes", description: "Optional extra notes" },
] as const satisfies readonly MemoShortcode[];

type ShortcodeToken = (typeof MEMO_SHORTCODES)[number]["token"];

/**
 * Every shortcode token a *caller* supplies a value for. `action_table` is
 * excluded: it is computed from `numbering`/`topic`/`status`, never a value
 * someone passes in directly.
 */
export type SubstitutableShortcodeToken = Exclude<
  ShortcodeToken,
  "action_table"
>;

/**
 * The values `renderShortcodes` and `buildMemorandumHtml` accept, one
 * required string per substitutable shortcode. Derived from
 * `MEMO_SHORTCODES` (see the comment there) rather than hand-listed, so the
 * "available shortcodes" list shown to users and the values this module
 * actually accepts cannot drift apart.
 */
export type ShortcodeValues = Record<SubstitutableShortcodeToken, string>;

const SUBSTITUTABLE_TOKENS = MEMO_SHORTCODES.map((s) => s.token).filter(
  (token): token is SubstitutableShortcodeToken => token !== "action_table",
);

const isSubstitutableToken = (
  token: string,
): token is SubstitutableShortcodeToken =>
  SUBSTITUTABLE_TOKENS.some((candidate) => candidate === token);

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape the five HTML-significant characters in `value`. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

/**
 * A token appears as `{{token}}`, optionally with whitespace inside the
 * braces (`{{ token }}`) — accepted because the template is hand-edited by
 * a person in the Configure popup, and a stray space either side of a
 * pasted token is an easy, harmless mistake to make.
 */
const SHORTCODE_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

const buildActionTable = (values: ShortcodeValues): string => {
  const numbering = escapeHtml(values.numbering);
  const topic = escapeHtml(values.topic);
  const status = escapeHtml(values.status);
  return (
    "<table>" +
    "<thead><tr><th>Numbering</th><th>Topic</th><th>Status</th></tr></thead>" +
    `<tbody><tr><td>${numbering}</td><td>${topic}</td><td>${status}</td></tr></tbody>` +
    "</table>"
  );
};

/**
 * Substitute every recognised `{{token}}` in `html` with its escaped value
 * from `values`. Unknown tokens are left untouched (a typo should be
 * visible in the draft, not silently swallowed), and this is a single pass
 * over the original template: a value that itself contains `{{...}}` is
 * never re-scanned, so a meeting named `{{notes}}` cannot inject notes.
 *
 * SECURITY NOTE — scope of the escaping: substituted values are HTML
 * **text**-escaped only (the five characters in `HTML_ESCAPES`). That makes
 * them safe to drop in as element text content, but it is NOT sufficient to
 * place a shortcode inside an HTML attribute, a URL, or a `style` value —
 * e.g. `<a href="mailto:{{recipient_name}}">` is not made safe by this
 * function, because attribute-context escaping has different rules
 * (unescaped quotes inside an attribute value still break out of it, and
 * `javascript:`-style URLs aren't neutralised by text-escaping at all). If
 * a future hand-edited template ever puts a shortcode inside an attribute,
 * this function does not protect it.
 */
export const renderShortcodes = (
  html: string,
  values: ShortcodeValues,
): string => {
  const actionTable = buildActionTable(values);

  return html.replace(SHORTCODE_PATTERN, (match, rawToken: string) => {
    if (rawToken === "action_table") {
      return actionTable;
    }

    if (!isSubstitutableToken(rawToken)) {
      return match;
    }

    return escapeHtml(values[rawToken]);
  });
};

/**
 * Neutralise raw HTML in Markdown source before handing it to `marked`.
 *
 * marked v17 removed the `sanitize` option, so by default raw HTML in the
 * source passes straight through unescaped, e.g.
 * `marked.parse("Hello <script>alert(1)</script> world")` renders the
 * `<script>` tag verbatim. Since this HTML is going into an outbound MAPIM
 * email, that is not acceptable.
 *
 * The fix (verified against the installed marked version): replace `<`
 * with `&lt;` in the Markdown source before parsing. No tag can then form,
 * so raw HTML is rendered as inert text instead of markup.
 *
 * Only `<` is escaped:
 * - `>` is left alone, or blockquotes (`> quoted`) would break.
 * - `&`, `"` and `'` are left alone, or entities and quoted text already in
 *   the source would be corrupted.
 * - The one casualty is `<url>` autolink syntax, which stops working —
 *   accepted, since mail clients linkify plain URLs anyway.
 */
const neutraliseRawHtml = (markdown: string): string =>
  markdown.replace(/</g, "&lt;");

const ENDING_TEXT =
  "Mohon jasa baik pihak tuan untuk memberikan maklumbalas terus kepada pihak sekretariat melalui emel governance@mapim.org. Segala usaha tuan kami dahului dengan ribuan terima kasih. Moga semua khidmat Ummah yang dikerjakan mendapat redhaNya dan dipermudahkan segala urusan. Terima kasih.";

const SIGNATURE_LINE_1 = "Sekretariat Pengurusan Mesyuarat";
const SIGNATURE_LINE_2 = "Wisma MAPIM Malaysia";
const SIGNATURE_DISCLAIMER =
  "//Emel ini dihantar secara automatik oleh sistem MAPIMCore.";

export type BuildMemorandumHtmlArgs = {
  /**
   * The memorandum's field values. See `MEMO_SHORTCODES` for the
   * vocabulary the Configure popup documents to users.
   */
  values: ShortcodeValues;
  /**
   * The editable body of the memorandum, as **Markdown** — exactly what
   * the client's WYSIWYG editor produced (`CommentEditor` round-trips
   * Markdown via `@tiptap/markdown`). This is the only user-editable part
   * of the memorandum: the frame around it, the one-row action table, the
   * closing paragraph and the signature are fixed and rendered the same
   * way on every send, regardless of what the author writes here.
   *
   * MUST be Markdown, never HTML. The route that calls this function must
   * never accept finished HTML from a client — that would let a caller
   * smuggle arbitrary markup into an outbound MAPIM email.
   */
  bodyMarkdown: string;
};

const mastheadStyle = {
  margin: "0 0 8px",
  color: "#262626",
  fontWeight: "600",
  fontSize: "12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

const headingStyle = {
  margin: "0 0 20px",
  color: "#262626",
  fontSize: "20px",
  lineHeight: "27px",
};

const bodyContentStyle = {
  margin: "0 0 20px",
  color: "#262626",
  fontSize: "14px",
  lineHeight: "22px",
};

const paragraphStyle = {
  margin: "0 0 14px",
  color: "#262626",
  fontSize: "14px",
  lineHeight: "22px",
};

const signatureDisclaimerStyle = {
  margin: "4px 0 0",
  color: "#737373",
  fontStyle: "italic" as const,
  fontSize: "12px",
  lineHeight: "18px",
};

/**
 * The pipeline (order matters):
 *
 * 1. The client sends Markdown, not HTML (`args.bodyMarkdown`).
 * 2. Render that Markdown to HTML with raw HTML neutralised
 *    (`neutraliseRawHtml` + `marked.parse`).
 * 3. Substitute shortcodes into the *rendered HTML*, with values
 *    HTML-escaped (`renderShortcodes`). Substituting earlier, into the
 *    Markdown source, would let a meeting's own title inject Markdown
 *    syntax; substituting after neutralises that.
 * 4. Wrap the result in the memo shell (fixed frame, one-row action table,
 *    closing paragraph and signature), built with `@react-email/components`
 *    and rendered by `@react-email/render`.
 */
export const buildMemorandumHtml = async (
  args: BuildMemorandumHtmlArgs,
): Promise<{ subject: string; html: string }> => {
  const { values, bodyMarkdown } = args;

  const subject = `Memorandum Tindakan bagi ${values.meeting_name} - ${values.numbering}`;

  const safeMarkdown = neutraliseRawHtml(bodyMarkdown);
  const bodyHtmlFromMarkdown = marked.parse(safeMarkdown, { async: false });
  const bodyHtml = renderShortcodes(bodyHtmlFromMarkdown, values);
  const tableHtml = renderShortcodes("{{action_table}}", values);

  const email = createElement(
    Html,
    null,
    createElement(Head),
    createElement(Preview, null, subject),
    createElement(
      Body,
      { style: { backgroundColor: "#ffffff", margin: "0", padding: "20px" } },
      createElement(
        Container,
        {
          style: {
            margin: "0 auto",
            maxWidth: "560px",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          },
        },
        createElement(Text, { style: mastheadStyle }, "MAPIMCore"),
        createElement(Heading, { style: headingStyle }, subject),
        createElement(
          Section,
          null,
          // bodyHtml is marked-rendered HTML with raw HTML already
          // neutralised (neutraliseRawHtml) and shortcode values already
          // HTML-escaped (renderShortcodes) — see the pipeline docstring
          // above.
          createElement("div", {
            style: bodyContentStyle,
            // biome-ignore lint/security/noDangerouslySetInnerHtml: see comment above
            dangerouslySetInnerHTML: { __html: bodyHtml },
          }),
        ),
        createElement(
          Section,
          null,
          // tableHtml comes from renderShortcodes, whose values are already
          // HTML-escaped — see the pipeline docstring above.
          createElement("div", {
            // biome-ignore lint/security/noDangerouslySetInnerHtml: see comment above
            dangerouslySetInnerHTML: { __html: tableHtml },
          }),
        ),
        createElement(Text, { style: paragraphStyle }, ENDING_TEXT),
        createElement(Hr),
        createElement(Text, { style: paragraphStyle }, SIGNATURE_LINE_1),
        createElement(Text, { style: paragraphStyle }, SIGNATURE_LINE_2),
        createElement(
          Text,
          { style: signatureDisclaimerStyle },
          SIGNATURE_DISCLAIMER,
        ),
      ),
    ),
  );

  const html = await render(email);

  return { subject, html };
};
