import { Request, Response, NextFunction } from "express";
import { forgotPasswordSchema } from "./forgot-password.schema";
import { forgotPasswordUseCase } from "./forgot-password.use-case";
import { ApiResponseFactory } from "../../../../@types/api/response.factory";
import { SchemaValidationError } from "../../../../@types/errors/schema-validation-error";

export async function forgotPasswordController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new SchemaValidationError(
        parsed.error.issues[0]?.message || "Dados inválidos"
      );
    }

    const result = await forgotPasswordUseCase(parsed.data, req.ip);

    return res
      .status(200)
      .json(ApiResponseFactory.success(result, result.message));
  } catch (err) {
    next(err);
  }
}
