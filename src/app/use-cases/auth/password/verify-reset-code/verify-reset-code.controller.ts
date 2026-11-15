import { Request, Response, NextFunction } from "express";
import { verifyResetCodeSchema } from "./verify-reset-code.schema";
import { verifyResetCodeUseCase } from "./verify-reset-code.use-case";
import { ApiResponseFactory } from "../../../../@types/api/response.factory";
import { SchemaValidationError } from "../../../../@types/errors/schema-validation-error";

export async function verifyResetCodeController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = verifyResetCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new SchemaValidationError(
        parsed.error.issues[0]?.message || "Dados inválidos"
      );
    }

    const result = await verifyResetCodeUseCase(parsed.data, req.ip);

    return res
      .status(200)
      .json(ApiResponseFactory.success(result, "Código válido"));
  } catch (err) {
    next(err);
  }
}
