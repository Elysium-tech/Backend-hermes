import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    NODE_ENV: "development" as "development" | "production" | "test",
    EMAIL_PROVIDER: "console" as "console" | "smtp" | "resend",
    MAIL_FROM: "Elysium <no-reply@elysium.test>",
    SMTP_HOST: undefined as string | undefined,
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: undefined as string | undefined,
    SMTP_PASS: undefined as string | undefined,
    RESEND_API_KEY: undefined as string | undefined,
    LOG_PRETTY: false,
  },
}));

vi.mock("../../config", () => ({ env: mockEnv }));

vi.mock("../../../shared/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  EmailDeliveryError,
  getEmailTransport,
  resetEmailTransport,
  sendEmail,
} from "./index";
import { passwordResetTemplate } from "./templates/password-reset";

describe("email service (adapter)", () => {
  beforeEach(() => {
    resetEmailTransport();
    mockEnv.NODE_ENV = "development";
    mockEnv.EMAIL_PROVIDER = "console";
    mockEnv.SMTP_HOST = undefined;
    mockEnv.SMTP_USER = undefined;
    mockEnv.SMTP_PASS = undefined;
    mockEnv.RESEND_API_KEY = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seleciona o provider de console em desenvolvimento", () => {
    expect(getEmailTransport().name).toBe("console");
  });

  it("seleciona o provider smtp quando configurado por env", () => {
    mockEnv.EMAIL_PROVIDER = "smtp";
    expect(getEmailTransport().name).toBe("smtp");
  });

  it("seleciona o provider resend quando configurado por env", () => {
    mockEnv.EMAIL_PROVIDER = "resend";
    expect(getEmailTransport().name).toBe("resend");
  });

  it("cacheia a instância do provider", () => {
    expect(getEmailTransport()).toBe(getEmailTransport());
  });

  it("recusa o provider de console em produção", () => {
    mockEnv.NODE_ENV = "production";

    expect(() => getEmailTransport()).toThrow(/não é permitido em produção/);
  });

  it("console aceita envio em desenvolvimento", async () => {
    await expect(
      sendEmail({
        to: "user@elysium.test",
        subject: "Teste",
        html: "<p>oi</p>",
        text: "oi",
      })
    ).resolves.toBeUndefined();
  });

  it("smtp falha com erro claro quando falta SMTP_HOST", async () => {
    mockEnv.EMAIL_PROVIDER = "smtp";

    await expect(
      sendEmail({ to: "user@elysium.test", subject: "s", html: "<p>x</p>" })
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("smtp exige SMTP_USER e SMTP_PASS juntos", async () => {
    mockEnv.EMAIL_PROVIDER = "smtp";
    mockEnv.SMTP_HOST = "in-v3.mailjet.com";
    mockEnv.SMTP_USER = "api-key";

    await expect(
      sendEmail({ to: "user@elysium.test", subject: "s", html: "<p>x</p>" })
    ).rejects.toThrow(/SMTP_USER e SMTP_PASS/);
  });

  it("resend falha quando falta a API key", async () => {
    mockEnv.EMAIL_PROVIDER = "resend";

    await expect(
      sendEmail({ to: "user@elysium.test", subject: "s", html: "<p>x</p>" })
    ).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("resend envia via HTTP com o payload esperado", async () => {
    mockEnv.EMAIL_PROVIDER = "resend";
    mockEnv.RESEND_API_KEY = "re_test_key";

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "user@elysium.test",
      subject: "Assunto",
      html: "<p>corpo</p>",
      text: "corpo",
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test_key"
    );

    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["user@elysium.test"]);
    expect(body.subject).toBe("Assunto");
    expect(body.from).toBe(mockEnv.MAIL_FROM);
  });

  it("resend propaga falha da API", async () => {
    mockEnv.EMAIL_PROVIDER = "resend";
    mockEnv.RESEND_API_KEY = "re_test_key";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("domain not verified", { status: 403 }))
    );

    await expect(
      sendEmail({ to: "user@elysium.test", subject: "s", html: "<p>x</p>" })
    ).rejects.toThrow(/403/);
  });
});

describe("passwordResetTemplate", () => {
  const content = passwordResetTemplate({
    displayName: "Ana",
    code: "123456",
    expiresInMinutes: 10,
  });

  it("coloca o código no assunto, no html e no texto", () => {
    expect(content.subject).toContain("123456");
    expect(content.html).toContain("123456");
    expect(content.text).toContain("123456");
  });

  it("informa o tempo de expiração", () => {
    expect(content.text).toContain("10 minutos");
    expect(content.html).toContain("10 minutos");
  });

  it("escapa HTML do nome do usuário (evita injeção no e-mail)", () => {
    const malicious = passwordResetTemplate({
      displayName: '<script>alert("xss")</script>',
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(malicious.html).not.toContain("<script>");
    expect(malicious.html).toContain("&lt;script&gt;");
  });
});
