import bcrypt from "bcryptjs";
import { env } from "../../../../config";
import { prisma } from "../../../../database/prisma";
import { ValidationError } from "../../../../@types/errors/validation-error";
import {
  INVALID_RESET_CODE_MESSAGE,
  assertValidResetCode,
} from "../password-reset-code";
import {
  PASSWORD_RESET_WINDOW_SECONDS,
  enforceRateLimit,
  hashIdentifier,
} from "../password-rate-limit";
import { ResetPasswordInput } from "./reset-password.schema";

const EMAIL_MAX_ATTEMPTS = 10;
const IP_MAX_ATTEMPTS = 20;

export interface ResetPasswordResult {
  message: string;
}

export async function resetPasswordUseCase(
  input: ResetPasswordInput,
  ipAddress?: string
): Promise<ResetPasswordResult> {
  enforceRateLimit(
    `reset:ip:${ipAddress ?? "unknown"}`,
    IP_MAX_ATTEMPTS,
    PASSWORD_RESET_WINDOW_SECONDS,
    "Muitas tentativas a partir deste endereço. Tente novamente mais tarde."
  );

  enforceRateLimit(
    `reset:email:${hashIdentifier(input.email)}`,
    EMAIL_MAX_ATTEMPTS,
    PASSWORD_RESET_WINDOW_SECONDS,
    "Muitas tentativas para este e-mail. Tente novamente mais tarde."
  );

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (!user) {
    // Mesmo erro de um código errado: não confirma se a conta existe.
    throw new ValidationError(INVALID_RESET_CODE_MESSAGE);
  }

  const { id: codeId } = await assertValidResetCode(user.id, input.code);

  const passwordHash = await bcrypt.hash(input.newPassword, env.SALT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    // Claim atômico: se outro request consumiu o mesmo código primeiro,
    // `count` é 0 e nada é alterado.
    const claimed = await tx.passwordResetCode.updateMany({
      where: { id: codeId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new ValidationError(INVALID_RESET_CODE_MESSAGE);
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Sem sessões válidas, o usuário está desconectado.
        status: "OFFLINE",
      },
    });

    // Higiene: nenhum código antigo sobrevive à troca de senha.
    await tx.passwordResetCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // Revoga TODAS as sessões: se a conta foi comprometida, o invasor cai.
    await tx.session.deleteMany({ where: { userId: user.id } });
  });

  return {
    message: "Senha redefinida com sucesso. Faça login novamente.",
  };
}
