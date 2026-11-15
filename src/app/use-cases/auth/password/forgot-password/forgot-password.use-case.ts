import { env } from "../../../../config";
import { prisma } from "../../../../database/prisma";
import { logger } from "../../../../../shared/logger";
import { sendEmail } from "../../../../services/email";
import { passwordResetTemplate } from "../../../../services/email/templates/password-reset";
import { generateOtpCode, hashOtpCode } from "../../../../utils/otp";
import {
  PASSWORD_RESET_WINDOW_SECONDS,
  enforceRateLimit,
  hashIdentifier,
} from "../password-rate-limit";
import { ForgotPasswordInput } from "./forgot-password.schema";

/** Resposta única, exista ou não a conta (anti-enumeração de usuários). */
export const FORGOT_PASSWORD_MESSAGE =
  "Se este e-mail estiver cadastrado, enviamos um código de recuperação de senha.";

const EMAIL_MAX_REQUESTS = 3;
const IP_MAX_REQUESTS = 10;

export interface ForgotPasswordResult {
  message: string;
}

export async function forgotPasswordUseCase(
  input: ForgotPasswordInput,
  ipAddress?: string
): Promise<ForgotPasswordResult> {
  const emailKey = hashIdentifier(input.email);

  // Os limites vêm ANTES da consulta ao banco, então o comportamento é
  // idêntico para e-mail cadastrado e não cadastrado.
  enforceRateLimit(
    `forgot:ip:${ipAddress ?? "unknown"}`,
    IP_MAX_REQUESTS,
    PASSWORD_RESET_WINDOW_SECONDS,
    "Muitas solicitações a partir deste endereço. Tente novamente mais tarde."
  );

  enforceRateLimit(
    `forgot:email:${emailKey}`,
    EMAIL_MAX_REQUESTS,
    PASSWORD_RESET_WINDOW_SECONDS,
    "Muitos códigos solicitados para este e-mail. Tente novamente mais tarde."
  );

  if (env.OTP_RESEND_COOLDOWN_SECONDS > 0) {
    enforceRateLimit(
      `forgot:cooldown:${emailKey}`,
      1,
      env.OTP_RESEND_COOLDOWN_SECONDS,
      "Aguarde antes de solicitar um novo código."
    );
  }

  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);

  await prisma.passwordResetCode.deleteMany({
    where: { userId: user.id, expiresAt: { lt: new Date() } },
  });

  await prisma.passwordResetCode.create({
    data: {
      userId: user.id,
      codeHash: hashOtpCode(code),
      expiresAt,
      ipAddress,
    },
  });

  try {
    await sendEmail({
      to: user.email,
      ...passwordResetTemplate({
        displayName: user.displayName,
        code,
        expiresInMinutes: env.OTP_TTL_MINUTES,
      }),
    });
  } catch (err) {
    // A falha de envio não pode virar resposta diferente: isso confirmaria
    // que o e-mail existe. Loga e segue com a mesma mensagem genérica.
    logger.error(
      { err, userId: user.id },
      "Falha ao enviar o código de recuperação de senha"
    );
  }

  return { message: FORGOT_PASSWORD_MESSAGE };
}
