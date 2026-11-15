import { env } from "../../config";
import { logger } from "../../../shared/logger";
import { createConsoleTransport } from "./providers/console";
import { createResendTransport } from "./providers/resend";
import { createSmtpTransport } from "./providers/smtp";
import type { EmailMessage, EmailProviderName, EmailTransport } from "./types";

/**
 * Registry de provedores.
 *
 * Adicionar um provedor novo:
 *   1. crie `providers/<nome>.ts` exportando uma função que devolve EmailTransport;
 *   2. adicione o nome em `EmailProviderName` (types.ts) e no enum do env;
 *   3. registre a factory no mapa abaixo.
 *
 * Nenhum caso de uso precisa saber que isso existe.
 */
const factories: Record<EmailProviderName, () => EmailTransport> = {
  console: createConsoleTransport,
  smtp: createSmtpTransport,
  resend: createResendTransport,
};

let cached: EmailTransport | null = null;

export function getEmailTransport(): EmailTransport {
  if (cached) {
    return cached;
  }

  const provider = env.EMAIL_PROVIDER;

  if (provider === "console" && env.NODE_ENV === "production") {
    throw new Error(
      "EMAIL_PROVIDER=console não é permitido em produção. Configure EMAIL_PROVIDER=smtp (ou resend)."
    );
  }

  cached = factories[provider]();

  logger.info({ provider: cached.name }, "Provider de e-mail selecionado");

  if (provider === "smtp" && !env.SMTP_HOST) {
    logger.warn(
      "EMAIL_PROVIDER=smtp sem SMTP_HOST: o primeiro envio vai falhar. Confira o .env."
    );
  }

  return cached;
}

/** Fachada única usada pelos casos de uso. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await getEmailTransport().send(message);
}

/** Limpa o singleton (testes e troca de configuração em runtime). */
export function resetEmailTransport(): void {
  cached = null;
}

export { EmailDeliveryError } from "./types";
export type { EmailMessage, EmailProviderName, EmailTransport } from "./types";
