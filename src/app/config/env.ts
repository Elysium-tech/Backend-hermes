import { z } from "zod";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET deve ter no mínimo 32 caracteres"),
  SALT_ROUNDS: z.coerce.number().min(4).max(15).default(10),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  BACKEND_URL: z.string().default("http://localhost:3000"),
  LOG_PRETTY: z.coerce.boolean().default(true),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  REDIS_URL: z.string().optional(),
  // E-mail — o provider é escolhido por env, nunca no código.
  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  MAIL_FROM: z.string().default("Elysium <no-reply@elysium.gg>"),
  // Provider "smtp" (genérico: Mailjet, Brevo, SMTP2GO, Gmail, SES...)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Provider "resend" (HTTP)
  RESEND_API_KEY: z.string().optional(),

  // Recuperação de senha (OTP de 6 dígitos)
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(600)
    .default(60),
  // Pepper do hash do código. Se ausente, usa JWT_SECRET.
  OTP_SECRET: z.string().min(16).optional(),

  // WebRTC signaling (chamadas)
  STUN_URL: z.string().default("stun:stun.l.google.com:19302"),
  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
