import { Router } from "express";
import { registerController } from "../use-cases/auth/register/register.controller";
import { loginController } from "../use-cases/auth/login/login.controller";
import { logoutController } from "../use-cases/auth/logout/logout.controller";
import { meController } from "../use-cases/auth/me/me.controller";
import { forgotPasswordController } from "../use-cases/auth/password/forgot-password/forgot-password.controller";
import { verifyResetCodeController } from "../use-cases/auth/password/verify-reset-code/verify-reset-code.controller";
import { resetPasswordController } from "../use-cases/auth/password/reset-password/reset-password.controller";
import { authMiddleware } from "../middlewares/auth-middleware";

export const authRoutes = Router();

authRoutes.post("/register", registerController);
authRoutes.post("/login", loginController);
authRoutes.post("/logout", authMiddleware, logoutController);
authRoutes.get("/me", authMiddleware, meController);

// Recuperação de senha por código OTP (rotas públicas, com rate limit próprio)
authRoutes.post("/password/forgot", forgotPasswordController);
authRoutes.post("/password/verify-code", verifyResetCodeController);
authRoutes.post("/password/reset", resetPasswordController);
