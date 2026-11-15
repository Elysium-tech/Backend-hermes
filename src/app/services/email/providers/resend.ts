import { env } from "../../../config";
import { EmailDeliveryError, type EmailTransport } from "../types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Provider HTTP da Resend (sem SDK, via fetch nativo).
 *
 * Exemplo de como um provedor de API entra sem acoplar o resto do código:
 * um arquivo, uma entrada na factory. O mesmo vale para Brevo, Mailgun,
 * SendGrid ou Amazon SES — os casos de uso não mudam uma linha.
 */
export function createResendTransport(): EmailTransport {
  return {
    name: "resend",

    async send(message) {
      if (!env.RESEND_API_KEY) {
        throw new EmailDeliveryError(
          "resend",
          "RESEND_API_KEY não configurada."
        );
      }

      let response: Response;

      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.MAIL_FROM,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new EmailDeliveryError(
          "resend",
          "Não foi possível conectar à API da Resend",
          err
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new EmailDeliveryError(
          "resend",
          `Resend respondeu ${response.status}: ${detail}`.trim()
        );
      }
    },
  };
}
