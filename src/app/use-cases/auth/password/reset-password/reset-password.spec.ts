import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    OTP_TTL_MINUTES: 10,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_SECRET: "pepper-de-teste-1234567890",
    JWT_SECRET: "jwt-secret-de-teste-que-nao-importa",
    SALT_ROUNDS: 10,
  },
}));

const { tx } = vi.hoisted(() => ({
  tx: {
    passwordResetCode: { updateMany: vi.fn() },
    user: { update: vi.fn() },
    session: { deleteMany: vi.fn() },
  },
}));

vi.mock("../../../../config", () => ({ env: mockEnv }));

vi.mock("../../../../database/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    passwordResetCode: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    session: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}));

vi.mock("../../../../services/email", () => ({ sendEmail: vi.fn() }));

vi.mock("../../../../../shared/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import bcrypt from "bcryptjs";
import { prisma } from "../../../../database/prisma";
import { resetRateLimits } from "../../../../utils/rate-limit";
import { hashOtpCode } from "../../../../utils/otp";
import { ValidationError } from "../../../../@types/errors/validation-error";
import { resetPasswordUseCase } from "./reset-password.use-case";
import { resetPasswordSchema } from "./reset-password.schema";

const VALID_CODE = "123456";

const fakeUser = { id: "user-123" };

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "code-1",
    userId: fakeUser.id,
    codeHash: hashOtpCode(VALID_CODE),
    attempts: 0,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    consumedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("resetPasswordUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();

    vi.mocked(prisma.user.findUnique).mockResolvedValue(fakeUser as never);
    vi.mocked(prisma.passwordResetCode.findFirst).mockResolvedValue(
      makeRecord() as never
    );
    vi.mocked(prisma.passwordResetCode.updateMany).mockResolvedValue({
      count: 1,
    } as never);
    vi.mocked(bcrypt.hash).mockResolvedValue("novo-hash" as never);

    vi.mocked(prisma.$transaction).mockImplementation((async (
      callback: (client: typeof tx) => Promise<unknown>
    ) => callback(tx)) as never);

    tx.passwordResetCode.updateMany.mockResolvedValue({ count: 1 });
    tx.user.update.mockResolvedValue({});
    tx.session.deleteMany.mockResolvedValue({ count: 3 });
  });

  it("troca a senha, consome o código e revoga todas as sessões", async () => {
    const result = await resetPasswordUseCase(
      {
        email: "ana@elysium.test",
        code: VALID_CODE,
        newPassword: "novaSenha123",
      },
      "10.0.0.1"
    );

    expect(result.message).toMatch(/Senha redefinida com sucesso/);

    expect(vi.mocked(bcrypt.hash).mock.calls[0][0]).toBe("novaSenha123");
    expect(vi.mocked(bcrypt.hash).mock.calls[0][1]).toBe(mockEnv.SALT_ROUNDS);

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: fakeUser.id },
      data: { passwordHash: "novo-hash", status: "OFFLINE" },
    });

    expect(tx.passwordResetCode.updateMany).toHaveBeenCalledWith({
      where: { id: "code-1", consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });

    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: fakeUser.id },
    });
  });

  it("conta a tentativa e rejeita código errado", async () => {
    await expect(
      resetPasswordUseCase({
        email: "ana@elysium.test",
        code: "000000",
        newPassword: "novaSenha123",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(prisma.passwordResetCode.updateMany).toHaveBeenCalledWith({
      where: { id: "code-1", attempts: { lt: mockEnv.OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejeita quando não há código válido", async () => {
    vi.mocked(prisma.passwordResetCode.findFirst).mockResolvedValue(null);

    await expect(
      resetPasswordUseCase({
        email: "ana@elysium.test",
        code: VALID_CODE,
        newPassword: "novaSenha123",
      })
    ).rejects.toThrow(/Código inválido ou expirado/);
  });

  it("rejeita quando o código estourou as tentativas", async () => {
    vi.mocked(prisma.passwordResetCode.findFirst).mockResolvedValue(
      makeRecord({ attempts: mockEnv.OTP_MAX_ATTEMPTS }) as never
    );

    await expect(
      resetPasswordUseCase({
        email: "ana@elysium.test",
        code: VALID_CODE,
        newPassword: "novaSenha123",
      })
    ).rejects.toThrow(/Código inválido ou expirado/);

    // Não incrementa além do teto.
    expect(prisma.passwordResetCode.updateMany).not.toHaveBeenCalled();
  });

  it("rejeita e-mail inexistente com a mesma mensagem (anti-enumeração)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      resetPasswordUseCase({
        email: "ninguem@elysium.test",
        code: VALID_CODE,
        newPassword: "novaSenha123",
      })
    ).rejects.toThrow(/Código inválido ou expirado/);

    expect(prisma.passwordResetCode.findFirst).not.toHaveBeenCalled();
  });

  it("rejeita quando o código já foi consumido por outra requisição", async () => {
    tx.passwordResetCode.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      resetPasswordUseCase({
        email: "ana@elysium.test",
        code: VALID_CODE,
        newPassword: "novaSenha123",
      })
    ).rejects.toThrow(/Código inválido ou expirado/);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe("resetPasswordSchema", () => {
  it("exige senha com 8 caracteres ou mais", () => {
    const result = resetPasswordSchema.safeParse({
      email: "ana@elysium.test",
      code: "123456",
      newPassword: "1234567",
    });

    expect(result.success).toBe(false);
  });

  it("normaliza e-mail e código antes de entregar ao caso de uso", () => {
    const result = resetPasswordSchema.parse({
      email: "  Ana@Elysium.Test ",
      code: "123 456",
      newPassword: "novaSenha123",
    });

    expect(result.email).toBe("ana@elysium.test");
    expect(result.code).toBe("123456");
  });

  it("rejeita código com quantidade errada de dígitos", () => {
    const result = resetPasswordSchema.safeParse({
      email: "ana@elysium.test",
      code: "12345",
      newPassword: "novaSenha123",
    });

    expect(result.success).toBe(false);
  });
});
