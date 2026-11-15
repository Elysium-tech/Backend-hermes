/**
 * Rate limit em memória (janela deslizante).
 *
 * Suficiente para a instância única que roda hoje. Quando houver mais de uma
 * instância (ou REDIS_URL configurado para o Socket.IO), troque o Map por
 * `INCR`/`EXPIRE` no Redis — a interface abaixo já isola essa decisão.
 */

const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Consome 1 tentativa de uma chave.
 *
 * @param key    Identificador do limite (ex: `forgot:email:<hash>`).
 * @param limit  Máximo de tentativas dentro da janela.
 * @param windowSeconds Tamanho da janela deslizante em segundos.
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (buckets.size > MAX_TRACKED_KEYS) {
    pruneExpired(now);
  }

  const hits = (buckets.get(key) ?? []).filter((ts) => now - ts < windowMs);

  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000)
    );

    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds };
  }

  hits.push(now);
  buckets.set(key, hits);

  return { allowed: true, retryAfterSeconds: 0 };
}

function pruneExpired(now: number) {
  for (const [key, hits] of buckets) {
    // Nenhuma janela usada no projeto passa de 1 hora.
    const alive = hits.filter((ts) => now - ts < 60 * 60 * 1000);
    if (alive.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, alive);
    }
  }
}

/** Usado pelos testes para isolar cenários. */
export function resetRateLimits(): void {
  buckets.clear();
}
