import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    OTP_TTL_MINUTES: 10,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_SECRET: "pepper-de-teste-1234567890",
    JWT_SECRET: "jwt-secret-de-teste-que-nao-importa",
  },
}));

vi.mock("../../../../config", () => ({ env: mockEnv }));

vi.mock("../../../../database/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    passwordResetCode: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../../../services/email", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("../../../../../shared/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from "../../../../database/prisma";
import { sendEmail } from "../../../../services/email";
import { resetRateLimits } from "../../../../utils/rate-limit";
import { hashOtpCode } from "../../../../utils/otp";
import { TooManyRequestsError } from "../../../../@types/errors/too-many-requests-error";
import {
  FORGOT_PASSWORD_MESSAGE,
  forgotPasswordUseCase,
} from "./forgot-password.use-case";

const fakeUser = {
  id: "user-123",
  email: "ana@elysium.test",
  displayName: "Ana",
};

describe("forgotPasswordUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();

    vi.mocked(prisma.passwordResetCode.create).mockResolvedValue({} as never);
    vi.mocked(prisma.passwordResetCode.deleteMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(sendEmail).mockResolvedValue(undefined);
  });

  it("gera código de 6 dígitos, guarda só o hash e envia o e-mail", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakeUser as never);

    const result = await forgotPasswordUseCase(
      { email: "ana@elysium.test" },
      "10.0.0.1"
    );

    expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);

    const created = vi.mocked(prisma.passwordResetCode.create).mock.calls[0][0]
      .data as {
      userId: string;
      codeHash: string;
      expiresAt: Date;
      ipAddress?: string;
    };

    expect(created.userId).toBe(fakeUser.id);
    expect(created.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(created.ipAddress).toBe("10.0.0.1");

    // O código enviado no e-mail precisa casar com o hash do banco.
    const [{ html }] = vi.mocked(sendEmail).mock.calls[0] as [{ html: string }];
    const sentCode = html.match(/>(\d{6})</)?.[1];

    expect(sentCode).toBeDefined();
    expect(hashOtpCode(sentCode as string)).toBe(created.codeHash);
  });

  it("devolve a mesma resposta quando o e-mail não existe (anti-enumeração)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await forgotPasswordUseCase(
      { email: "ninguem@elysium.test" },
      "10.0.0.2"
    );

    expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);
    expect(prisma.passwordResetCode.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("bloqueia novo pedido dentro do cooldown", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakeUser as never);

    await forgotPasswordUseCase({ email: "ana@elysium.test" }, "10.0.0.3");

    await expect(
      forgotPasswordUseCase({ email: "ana@elysium.test" }, "10.0.0.3")
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it("aplica o cooldown igual para e-mail inexistente (não vaza cadastro)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await forgotPasswordUseCase({ email: "ninguem@elysium.test" }, "10.0.0.4");

    await expect(
      forgotPasswordUseCase({ email: "ninguem@elysium.test" }, "10.0.0.4")
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it("não deixa o cooldown de um e-mail afetar outro", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakeUser as never);

    await forgotPasswordUseCase({ email: "ana@elysium.test" }, "10.0.0.5");
    await expect(
      forgotPasswordUseCase({ email: "bia@elysium.test" }, "10.0.0.5")
    ).resolves.toEqual({ message: FORGOT_PASSWORD_MESSAGE });
  });

  it("mantém a resposta genérica mesmo se o envio falhar", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakeUser as never);
    vi.mocked(sendEmail).mockRejectedValue(new Error("SMTP fora do ar"));

    await expect(
      forgotPasswordUseCase({ email: "ana@elysium.test" }, "10.0.0.6")
    ).resolves.toEqual({ message: FORGOT_PASSWORD_MESSAGE });
  });
});
