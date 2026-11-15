import { z } from "zod";
import { emailField, resetCodeField } from "../password-fields";

export const resetPasswordSchema = z.object({
  email: emailField,
  code: resetCodeField,
  newPassword: z.string().min(8, "Senha deve ter no mínimo 8 caracteres"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
