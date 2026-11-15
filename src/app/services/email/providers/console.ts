import { logger } from "../../../../shared/logger";
import { env } from "../../../config";
import { EmailDeliveryError, type EmailTransport } from "../types";

/**
 * Provider de desenvolvimento: não envia nada, imprime o e-mail no console.
 *
 * Existe para você rodar o fluxo inteiro sem cadastrar provedor nenhum.
 * Recusa-se a operar em produção de propósito — em produção, um e-mail que
 * "foi enviado" só no log significa usuário travado para sempre.
 */
export function createConsoleTransport(): EmailTransport {
  return {
    name: "console",

    async send(message) {
      if (env.NODE_ENV === "production") {
        throw new EmailDeliveryError(
          "console",
          "EMAIL_PROVIDER=console não é permitido em produção. Configure SMTP ou Resend."
        );
      }

      logger.info(
        {
          email: {
            from: env.MAIL_FROM,
            to: message.to,
            subject: message.subject,
          },
        },
        "E-mail interceptado pelo provider de console (nenhum envio real)"
      );

      logger.debug({ body: message.text ?? message.html }, "Corpo do e-mail");
    },
  };
}
