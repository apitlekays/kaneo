import * as nodemailer from "nodemailer";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type OutgoingMail = {
  /** Display name for the From header; the address is always EMAIL_FROM. */
  fromName?: string;
  to: string | string[];
  cc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
};

export type EmailProvider = "resend" | "smtp";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15_000;

/**
 * Which provider sends mail. Resend when `RESEND_API_KEY` is set, otherwise
 * the SMTP transport the fork has always used — so a deploy that has not
 * been given a Resend key keeps sending exactly as before.
 */
export function emailProvider(): EmailProvider {
  return process.env.RESEND_API_KEY ? "resend" : "smtp";
}

/** The sending address. `EMAIL_FROM` wins; `SMTP_FROM` is the old name. */
export function fromAddress(): string | undefined {
  return process.env.EMAIL_FROM || process.env.SMTP_FROM || undefined;
}

/** True when the active provider has everything it needs to send. */
export function isEmailConfigured(): boolean {
  if (!fromAddress()) return false;
  return emailProvider() === "resend" ? true : !!process.env.SMTP_HOST;
}

function list(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : value.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * The From header. A caller-supplied display name replaces any name already
 * in EMAIL_FROM ("MAPIMCore <core@…>"), rather than nesting inside it.
 */
function composeFrom(fromName?: string): string {
  const configured = fromAddress() ?? "";
  if (!fromName) return configured;
  const bare = configured.match(/<([^>]+)>/)?.[1] ?? configured;
  return `${fromName} <${bare.trim()}>`;
}

let smtpTransport: nodemailer.Transporter | null = null;
function smtp() {
  smtpTransport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    secure: process.env.SMTP_SECURE !== "false",
    port: Number(process.env.SMTP_PORT),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    requireTLS: process.env.SMTP_REQUIRE_TLS === "true",
    ignoreTLS: process.env.SMTP_IGNORE_TLS === "true",
  });
  return smtpTransport;
}

async function sendViaResend(mail: OutgoingMail): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: composeFrom(mail.fromName),
        to: list(mail.to),
        cc: list(mail.cc),
        reply_to: mail.replyTo ? list(mail.replyTo) : undefined,
        subject: mail.subject,
        html: mail.html,
        attachments: mail.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
          content_type: a.contentType,
        })),
      }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;

    if (!response.ok || !body?.id) {
      throw new Error(
        `Resend rejected the email (${response.status}): ${
          body?.message ?? body?.name ?? "no detail"
        }`,
      );
    }
    return body.id;
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaSmtp(mail: OutgoingMail): Promise<string> {
  const info = await smtp().sendMail({
    from: composeFrom(mail.fromName),
    to: list(mail.to)?.join(", "),
    cc: list(mail.cc)?.join(", "),
    replyTo: mail.replyTo,
    subject: mail.subject,
    html: mail.html,
    attachments: mail.attachments,
  });
  return info.messageId;
}

/**
 * Sends one email through the configured provider and returns its
 * provider message id. Throws `SMTP_NOT_CONFIGURED` when nothing is
 * configured — the name predates Resend and callers match on it.
 */
export async function sendMail(mail: OutgoingMail): Promise<string> {
  if (!isEmailConfigured()) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }
  return emailProvider() === "resend" ? sendViaResend(mail) : sendViaSmtp(mail);
}
