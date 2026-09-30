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

describe("Resend provider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    sendMailMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-id" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "MAPIMCore <core@mapim.org>";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  function sentBody() {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test",
    );
    return JSON.parse(init.body as string);
  }

  it("sends through Resend instead of SMTP when RESEND_API_KEY is set", async () => {
    const { sendCorrespondenceEmail } = await import("./send-email");

    const result = await sendCorrespondenceEmail(
      ["a@example.com", "b@example.com"],
      "Memorandum",
      "<p>html</p>",
      [
        {
          filename: "m.pdf",
          content: Buffer.from("pdf"),
          contentType: "application/pdf",
        },
      ],
      {
        cc: "c@example.com",
        replyTo: "governance@mapim.org",
        fromName: "Sekretariat",
      },
    );

    expect(result).toEqual({ messageId: "resend-id" });
    expect(sendMailMock).not.toHaveBeenCalled();
    const body = sentBody();
    expect(body).toMatchObject({
      // The caller's name replaces the one configured in EMAIL_FROM.
      from: "Sekretariat <core@mapim.org>",
      to: ["a@example.com", "b@example.com"],
      cc: ["c@example.com"],
      reply_to: ["governance@mapim.org"],
      subject: "Memorandum",
      html: "<p>html</p>",
    });
    expect(body.attachments).toEqual([
      {
        filename: "m.pdf",
        content: Buffer.from("pdf").toString("base64"),
        content_type: "application/pdf",
      },
    ]);
  });

  it("uses the bare EMAIL_FROM when no display name is given", async () => {
    process.env.EMAIL_FROM = "core@mapim.org";
    const { sendNotificationEmail } = await import("./send-email");

    const result = await sendNotificationEmail(
      "to@example.com",
      "Task offered",
      {
        title: "Task offered",
        message: "Take this",
      },
    );

    expect(result).toEqual({ success: true });
    expect(sentBody()).toMatchObject({
      from: "core@mapim.org",
      to: ["to@example.com"],
      subject: "Task offered",
    });
  });

  it("falls back to SMTP_FROM for the sending address", async () => {
    delete process.env.EMAIL_FROM;
    process.env.SMTP_FROM = "old@mapim.org";
    const { sendCorrespondenceEmail } = await import("./send-email");

    await sendCorrespondenceEmail("to@example.com", "s", "<p>x</p>");

    expect(sentBody().from).toBe("old@mapim.org");
  });

  it("surfaces Resend's error message when it rejects", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "validation_error",
          message: "domain not verified",
        }),
        { status: 403 },
      ),
    );
    const { sendCorrespondenceEmail } = await import("./send-email");

    await expect(
      sendCorrespondenceEmail("to@example.com", "s", "<p>x</p>"),
    ).rejects.toThrow("domain not verified");
  });

  it("reports not configured when there is no sending address", async () => {
    delete process.env.EMAIL_FROM;
    const { sendNotificationEmail } = await import("./send-email");

    const result = await sendNotificationEmail("to@example.com", "s", {
      title: "t",
      message: "m",
    });

    expect(result).toEqual({ success: false, reason: "SMTP_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
