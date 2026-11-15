import { z } from "zod";
import { emailField, resetCodeField } from "../password-fields";

export const verifyResetCodeSchema = z.object({
  email: emailField,
  code: resetCodeField,
});

export type VerifyResetCodeInput = z.infer<typeof verifyResetCodeSchema>;
