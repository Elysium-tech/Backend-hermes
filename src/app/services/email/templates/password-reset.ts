/**
 * Template do e-mail de recuperação de senha.
 *
 * Regras que valem a pena manter: HTML de tabela com CSS inline (clientes de
 * e-mail não entendem flexbox), sem imagens externas e sem links suspeitos —
 * isso reduz muito a chance de cair em spam, que é o pior cenário possível
 * para um e-mail de código.
 */

export interface PasswordResetTemplateInput {
  displayName: string;
  code: string;
  expiresInMinutes: number;
  appName?: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function passwordResetTemplate({
  displayName,
  code,
  expiresInMinutes,
  appName = "Elysium",
}: PasswordResetTemplateInput): EmailContent {
  const safeName = escapeHtml(displayName);
  const subject = `${code} é seu código de recuperação — ${appName}`;

  const text = [
    `Olá, ${displayName}.`,
    "",
    `Seu código para redefinir a senha no ${appName} é: ${code}`,
    "",
    `O código expira em ${expiresInMinutes} minutos e só pode ser usado uma vez.`,
    "",
    "Se você não pediu essa alteração, ignore este e-mail: sua senha continua a mesma.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#0f1117;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0f1117;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#161922;border:1px solid #242938;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8b93a7;">${appName}</p>
                <h1 style="margin:12px 0 0 0;font-size:22px;line-height:1.3;color:#f4f6fb;font-weight:600;">
                  Recuperação de senha
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#c3c9d8;">
                  Olá, ${safeName}. Use o código abaixo para definir uma nova senha.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="background-color:#0f1117;border:1px solid #2e3547;border-radius:10px;padding:20px 12px;">
                      <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;letter-spacing:0.32em;color:#7c8cff;font-weight:700;">${escapeHtml(code)}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#8b93a7;">
                  O código expira em <strong style="color:#c3c9d8;">${expiresInMinutes} minutos</strong> e só pode ser usado uma vez.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px 0 32px;">
                <hr style="border:0;border-top:1px solid #242938;margin:0;" />
              </td>
            </tr>

            <tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7688;">
                  Se você não pediu a alteração, ignore este e-mail — sua senha continua a mesma.
                  Nunca compartilhe este código com ninguém.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:16px 0 0 0;font-size:11px;color:#5a6072;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            ${appName} — mensagem automática, não responda.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

/** `displayName` vem do usuário: escapar evita injeção de HTML no e-mail. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
