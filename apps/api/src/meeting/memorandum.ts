/**
 * Pure shortcode renderer for the Meeting Minutes memorandum email body.
 *
 * No database, no clock, no randomness — this module only turns an
 * author-edited HTML template plus a bag of field values into the final
 * HTML that gets sent. It is deliberately dumb: the caller (the send
 * route, added later) is responsible for sourcing the values.
 */

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
 */
export const MEMO_SHORTCODES: readonly MemoShortcode[] = [
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
];

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

const buildActionTable = (values: Record<string, string>): string => {
  const numbering = escapeHtml(values.numbering ?? "");
  const topic = escapeHtml(values.topic ?? "");
  const status = escapeHtml(values.status ?? "");
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
 */
export const renderShortcodes = (
  html: string,
  values: Record<string, string>,
): string => {
  const actionTable = buildActionTable(values);

  return html.replace(SHORTCODE_PATTERN, (match, token: string) => {
    if (token === "action_table") {
      return actionTable;
    }

    if (!Object.hasOwn(values, token)) {
      return match;
    }

    const value = values[token];
    return value === undefined ? match : escapeHtml(value);
  });
};
