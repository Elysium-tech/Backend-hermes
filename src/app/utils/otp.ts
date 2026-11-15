import crypto from "node:crypto";
import { env } from "../config";

/** Códigos OTP de recuperação de senha têm sempre 6 dígitos. */
export const OTP_LENGTH = 6;

/**
 * Gera um código numérico de 6 dígitos com entropia criptográfica.
 *
 * NUNCA use Math.random() aqui: ele é previsível e permite que um atacante
 * adivinhe códigos futuros a partir de códigos passados.
 */
export function generateOtpCode(): string {
  // randomInt(0, 1_000_000) → 0..999999, uniforme e sem viés de módulo.
  return crypto
    .randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

function otpPepper(): string {
  return env.OTP_SECRET ?? env.JWT_SECRET;
}

/**
 * Hash determinístico (HMAC-SHA256) do código.
 *
 * Determinístico de propósito: permite buscar o registro pelo usuário e
 * comparar sem guardar o código em claro. O pepper impede que um dump do
 * banco seja quebrado por força bruta em 1 milhão de tentativas.
 */
export function hashOtpCode(code: string): string {
  return crypto.createHmac("sha256", otpPepper()).update(code).digest("hex");
}

/** Comparação em tempo constante, resistente a timing attacks. */
export function verifyOtpCode(code: string, expectedHash: string): boolean {
  if (!/^\d+$/.test(code)) {
    return false;
  }

  const actual = Buffer.from(hashOtpCode(code), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

/** Normaliza a entrada do usuário (aceita "123 456" ou "123-456"). */
export function normalizeOtpCode(input: string): string {
  return input.replace(/\D/g, "");
}
