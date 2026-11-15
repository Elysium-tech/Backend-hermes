import { env } from "../../../config";
import { prisma } from "../../../database/prisma";
import { ValidationError } from "../../../@types/errors/validation-error";
import { verifyOtpCode } from "../../../utils/otp";

/**
 * Mensagem única para todos os casos de falha.
 *
 * Diferenciar "código errado" de "código expirado" de "e-mail não cadastrado"
 * transforma o endpoint em um oráculo para descobrir quem tem conta.
 */
export const INVALID_RESET_CODE_MESSAGE = "Código inválido ou expirado";

export interface ValidResetCode {
  id: string;
}

/**
 * Valida o código mais recente do usuário e devolve a referência do registro.
 *
 * Não consome o código: quem consome é o reset, de forma atômica. Usado também
 * pelo passo de verificação (UX), para o front confirmar o código antes de
 * pedir a nova senha.
 */
export async function assertValidResetCode(
  userId: string,
  code: string
): Promise<ValidResetCode> {
  const record = await prisma.passwordResetCode.findFirst({
    where: {
      userId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    throw new ValidationError(INVALID_RESET_CODE_MESSAGE);
  }

  if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw new ValidationError(INVALID_RESET_CODE_MESSAGE);
  }

  if (!verifyOtpCode(code, record.codeHash)) {
    // Incremento condicional: nunca passa do teto mesmo com requisições
    // concorrentes tentando adivinhar o código.
    await prisma.passwordResetCode.updateMany({
      where: { id: record.id, attempts: { lt: env.OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });

    throw new ValidationError(INVALID_RESET_CODE_MESSAGE);
  }

  return { id: record.id };
}
