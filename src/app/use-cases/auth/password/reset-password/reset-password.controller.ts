import { Request, Response, NextFunction } from "express";
import { resetPasswordSchema } from "./reset-password.schema";
import { resetPasswordUseCase } from "./reset-password.use-case";
import { ApiResponseFactory } from "../../../../@types/api/response.factory";
import { SchemaValidationError } from "../../../../@types/errors/schema-validation-error";

export async function resetPasswordController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new SchemaValidationError(
        parsed.error.issues[0]?.message || "Dados inválidos"
      );
    }

    const result = await resetPasswordUseCase(parsed.data, req.ip);

    return res
      .status(200)
      .json(ApiResponseFactory.success(result, result.message));
  } catch (err) {
    next(err);
  }
}
