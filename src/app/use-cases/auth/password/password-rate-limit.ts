import { createHash } from "node:crypto";
import { TooManyRequestsError } from "../../../@types/errors/too-many-requests-error";
import { consumeRateLimit } from "../../../utils/rate-limit";

/** Janela padrão do fluxo de recuperação de senha. */
export const PASSWORD_RESET_WINDOW_SECONDS = 15 * 60;

/** Identificadores (e-mail, IP) nunca vão em claro para o store de limite. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  message: string
): void {
  const result = consumeRateLimit(key, limit, windowSeconds);

  if (!result.allowed) {
    throw new TooManyRequestsError(
      `${message} (${formatRetry(result.retryAfterSeconds)})`,
      result.retryAfterSeconds
    );
  }
}

function formatRetry(seconds: number): string {
  if (seconds >= 60) {
    return `${Math.ceil(seconds / 60)} min`;
  }

  return `${seconds}s`;
}
