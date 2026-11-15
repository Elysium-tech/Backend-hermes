import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../../config";
import { logger } from "../../../../shared/logger";
import { EmailDeliveryError, type EmailTransport } from "../types";

/**
 * Provider SMTP genérico.
 *
 * Serve para qualquer provedor que fale SMTP — o que cobre Mailjet, Brevo,
 * SMTP2GO, Gmail, Amazon SES, Postmark e praticamente todos. A escolha do
 * provedor fica 100% nas variáveis de ambiente:
 *
 *   Mailjet  → host in-v3.mailjet.com, porta 587, user = API Key, pass = Secret Key
 *   Brevo    → host smtp-relay.brevo.com, porta 587
 *   SMTP2GO  → host mail.smtp2go.com, porta 2525
 *   Gmail    → host smtp.gmail.com, porta 587, pass = app password
 *
 * O transporter é criado sob demanda (lazy) para não abrir conexão em testes
 * ou quando o e-mail nunca é usado.
 */
export function createSmtpTransport(): EmailTransport {
  let transporter: Transporter | null = null;

  function getTransporter(): Transporter {
    if (transporter) {
      return transporter;
    }

    if (!env.SMTP_HOST) {
      throw new EmailDeliveryError(
        "smtp",
        "SMTP_HOST não configurado. Defina SMTP_HOST/PORT/USER/PASS ou use EMAIL_PROVIDER=console."
      );
    }

    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
      throw new EmailDeliveryError(
        "smtp",
        "SMTP_USER e SMTP_PASS devem ser informados juntos."
      );
    }

    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // true apenas para porta 465 (TLS direto). Em 587 o STARTTLS é automático.
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS as string }
        : undefined,
    });

    return transporter;
  }

  return {
    name: "smtp",

    async send(message) {
      try {
        const info = await getTransporter().sendMail({
          from: env.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });

        // O SMTP pode aceitar (250) e não entregar — conta bloqueada, provedor
        // em revisão. Registrar a resposta crua é o que separa "não sei o que
        // aconteceu" de "o provedor respondeu X".
        logger.debug(
          {
            messageId: info.messageId,
            response: info.response,
            accepted: info.accepted?.length ?? 0,
            rejected: info.rejected?.length ?? 0,
          },
          "Resposta do provedor SMTP"
        );

        if (info.rejected?.length) {
          logger.warn(
            { messageId: info.messageId, rejected: info.rejected },
            "Provedor SMTP rejeitou destinatários"
          );
        }
      } catch (err) {
        if (err instanceof EmailDeliveryError) {
          throw err;
        }

        throw new EmailDeliveryError(
          "smtp",
          "Falha ao enviar e-mail via SMTP",
          err
        );
      }
    },
  };
}
