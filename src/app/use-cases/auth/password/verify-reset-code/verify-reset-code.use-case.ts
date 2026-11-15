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
import { VerifyResetCodeInput } from "./verify-reset-code.schema";

const EMAIL_MAX_ATTEMPTS = 10;
const IP_MAX_ATTEMPTS = 20;

export interface VerifyResetCodeResult {
  valid: true;
}

/**
 * Passo de UX: confirma o código antes de pedir a nova senha.
 *
 * Não consome o código e não altera nada — mas conta tentativa, para não
 * virar um oráculo gratuito de força bruta.
 */
export async function verifyResetCodeUseCase(
  input: VerifyResetCodeInput,
  ipAddress?: string
): Promise<VerifyResetCodeResult> {
  enforceRateLimit(
    `verify:ip:${ipAddress ?? "unknown"}`,
    IP_MAX_ATTEMPTS,
    PASSWORD_RESET_WINDOW_SECONDS,
    "Muitas tentativas a partir deste endereço. Tente novamente mais tarde."
  );

  enforceRateLimit(
    `verify:email:${hashIdentifier(input.email)}`,
    EMAIL_MAX_ATTEMPTS,
    PASSWORD_RESET_WINDOW_SECONDS,
    "Muitas tentativas para este e-mail. Tente novamente mais tarde."
  );

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (!user) {
    throw new ValidationError(INVALID_RESET_CODE_MESSAGE);
  }

  await assertValidResetCode(user.id, input.code);

  return { valid: true };
}
