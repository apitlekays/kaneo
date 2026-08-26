import type { EmailResult } from "../../../packages/email/src/send-email";

// Records calls made through `sendNotificationEmail` so integration tests can
// assert a notification was actually delivered, without depending on real
// SMTP config or a sleep. Cleared by `resetSentNotificationEmails` — call
// that in `beforeEach` in any test that inspects it.
export type SentNotificationEmail = {
  to: string;
  subject: string;
  data: unknown;
};

export const sentNotificationEmails: SentNotificationEmail[] = [];

export function resetSentNotificationEmails() {
  sentNotificationEmails.length = 0;
}

export async function sendNotificationEmail(
  to: string,
  subject: string,
  data: unknown,
): Promise<EmailResult> {
  sentNotificationEmails.push({ to, subject, data });
  return { success: true };
}

export async function sendMagicLinkEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

export async function sendOtpEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

export async function sendWorkspaceInvitationEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<EmailResult> {
  return { success: true };
}
