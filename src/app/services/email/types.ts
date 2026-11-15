/**
 * Contrato do serviço de e-mail.
 *
 * Tudo na aplicação depende APENAS destas interfaces — nenhum caso de uso
 * importa SDK de provedor. Trocar de provedor = adicionar um arquivo em
 * `providers/` e registrar na factory de `index.ts`.
 */

export type EmailProviderName = "console" | "smtp" | "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Versão texto puro: melhora entrega e cobre clientes sem HTML. */
  text?: string;
}

export interface EmailTransport {
  readonly name: EmailProviderName;
  send(message: EmailMessage): Promise<void>;
}

/** Erro padronizado para falhas de envio, independente do provedor. */
export class EmailDeliveryError extends Error {
  constructor(
    public readonly provider: EmailProviderName,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
