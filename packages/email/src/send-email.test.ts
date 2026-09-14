import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();

vi.mock("dotenv-mono", () => ({
  config: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: sendMailMock,
  })),
}));

const ORIGINAL_ENV = { ...process.env };

describe("sendCorrespondenceEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "test-message-id" });
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "noreply@example.com";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws SMTP_NOT_CONFIGURED when SMTP_HOST is unset", async () => {
    delete process.env.SMTP_HOST;
    const { sendCorrespondenceEmail } = await import("./send-email");

    await expect(
      sendCorrespondenceEmail("to@example.com", "subject", "<p>html</p>"),
    ).rejects.toThrow("SMTP_NOT_CONFIGURED");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("throws SMTP_NOT_CONFIGURED when SMTP_FROM is unset", async () => {
    delete process.env.SMTP_FROM;
    const { sendCorrespondenceEmail } = await import("./send-email");

    await expect(
      sendCorrespondenceEmail("to@example.com", "subject", "<p>html</p>"),
    ).rejects.toThrow("SMTP_NOT_CONFIGURED");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("uses the bare SMTP_FROM address when no fromName is given", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail("to@example.com", "subject", "<p>html</p>");

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "noreply@example.com" }),
    );
  });

  it("composes a friendly From header when fromName is given", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail(
      "to@example.com",
      "subject",
      "<p>html</p>",
      undefined,
      { fromName: "General Management" },
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "General Management <noreply@example.com>",
      }),
    );
  });

  it("joins an array of `to` recipients with a comma-space", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail(
      ["a@example.com", "b@example.com"],
      "subject",
      "<p>html</p>",
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@example.com, b@example.com" }),
    );
  });

  it("passes replyTo through when given, and omits it otherwise", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail(
      "to@example.com",
      "subject",
      "<p>html</p>",
      undefined,
      { replyTo: "reply@example.com" },
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "reply@example.com" }),
    );

    sendMailMock.mockClear();
    await sendCorrespondenceEmail("to@example.com", "subject", "<p>html</p>");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: undefined }),
    );
  });

  it("passes attachments through unchanged", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");
    const attachments = [{ filename: "letter.pdf", content: Buffer.from("x") }];

    await sendCorrespondenceEmail(
      "to@example.com",
      "subject",
      "<p>html</p>",
      attachments,
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ attachments }),
    );
  });

  it("resolves with the provider messageId", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    const result = await sendCorrespondenceEmail(
      "to@example.com",
      "subject",
      "<p>html</p>",
    );

    expect(result).toEqual({ messageId: "test-message-id" });
  });

  it("passes a single cc address through", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail(
      "to@example.com",
      "subject",
      "<p>html</p>",
      undefined,
      { cc: "cc@example.com" },
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ cc: "cc@example.com" }),
    );
  });

  it("joins an array of cc addresses with a comma-space", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail(
      "to@example.com",
      "subject",
      "<p>html</p>",
      undefined,
      { cc: ["cc1@example.com", "cc2@example.com"] },
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ cc: "cc1@example.com, cc2@example.com" }),
    );
  });

  it("omits cc when not given", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail("to@example.com", "subject", "<p>html</p>");

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ cc: undefined }),
    );
  });
});
