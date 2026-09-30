import { render } from "@react-email/components";
import { config } from "dotenv-mono";
import type { MagicLinkEmailProps } from "./templates/magic-link";
import MagicLinkEmail from "./templates/magic-link";
import NotificationEmail, {
  type NotificationEmailProps,
} from "./templates/notification";
import type { OtpEmailProps } from "./templates/otp";
import OtpEmail from "./templates/otp";
import PasswordResetEmail, {
  type PasswordResetEmailProps,
} from "./templates/password-reset";
import WorkspaceInvitationEmail, {
  type WorkspaceInvitationEmailProps,
} from "./templates/workspace-invitation";
import { isEmailConfigured, type MailAttachment, sendMail } from "./transport";

config();

export const sendMagicLinkEmail = async (
  to: string,
  subject: string,
  data: MagicLinkEmailProps,
) => {
  try {
    await sendMail({ to, subject, html: await render(MagicLinkEmail(data)) });
  } catch (error) {
    console.error("Error sending magic link email", error);
  }
};

export const sendOtpEmail = async (
  to: string,
  subject: string,
  data: OtpEmailProps,
) => {
  try {
    await sendMail({ to, subject, html: await render(OtpEmail(data)) });
  } catch (error) {
    console.error("Error sending OTP email", error);
  }
};

export const sendPasswordResetEmail = async (
  to: string,
  subject: string,
  data: PasswordResetEmailProps,
) => {
  try {
    await sendMail({
      to,
      subject,
      html: await render(PasswordResetEmail(data)),
    });
  } catch (error) {
    console.error("Error sending password reset email", error);
  }
};

export type EmailResult = {
  success: boolean;
  reason?: "SMTP_NOT_CONFIGURED";
};

export const sendWorkspaceInvitationEmail = async (
  to: string,
  subject: string,
  data: WorkspaceInvitationEmailProps,
): Promise<EmailResult> => {
  if (!isEmailConfigured()) {
    return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  try {
    const html = await render(WorkspaceInvitationEmail({ ...data, to }));
    await sendMail({ to, subject, html });
    return { success: true };
  } catch (error) {
    console.error("Error sending workspace invitation email", error);
    throw error;
  }
};

export const sendNotificationEmail = async (
  to: string,
  subject: string,
  data: NotificationEmailProps,
): Promise<EmailResult> => {
  if (!isEmailConfigured()) {
    return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  try {
    const html = await render(NotificationEmail(data));
    await sendMail({ to, subject, html });
    return { success: true };
  } catch (error) {
    console.error("Error sending notification email", error);
    throw error;
  }
};

export type CorrespondenceAttachment = MailAttachment;

/**
 * Send an official memo/circular/letter through the same provider used for
 * all platform mail (OTP, notifications). Supports attachments (the signed
 * PDF), CC, and an optional friendly From-name / Reply-To. Throws on send
 * failure so the dispatch record can capture it.
 */
export const sendCorrespondenceEmail = async (
  to: string | string[],
  subject: string,
  html: string,
  attachments?: CorrespondenceAttachment[],
  options?: { replyTo?: string; fromName?: string; cc?: string | string[] },
): Promise<{ messageId: string }> => {
  const messageId = await sendMail({
    to,
    subject,
    html,
    attachments,
    replyTo: options?.replyTo,
    fromName: options?.fromName,
    cc: options?.cc,
  });
  return { messageId };
};
