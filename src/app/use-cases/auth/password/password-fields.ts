import { z } from "zod";
import { normalizeOtpCode } from "../../../utils/otp";

/** E-mail normalizado (trim + lowercase) — usado em todo o fluxo. */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("E-mail inválido");

/**
 * Código OTP de 6 dígitos.
 *
 * Aceita "123 456" e "123-456" porque usuários costumam colar com separador;
 * o valor final entregue ao caso de uso são sempre 6 dígitos.
 */
export const resetCodeField = z
  .string()
  .transform((value) => normalizeOtpCode(value))
  .refine((value) => value.length === 6, "Código deve ter 6 dígitos");
