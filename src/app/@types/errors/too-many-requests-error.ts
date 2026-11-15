import { ApiError } from "../api/api-error";
import { internalErrorCodes } from "./internal-error-codes";

export class TooManyRequestsError extends ApiError {
  constructor(
    message = "Muitas tentativas. Tente novamente em alguns minutos.",
    retryAfterSeconds?: number
  ) {
    super(
      message,
      429,
      internalErrorCodes.TOO_MANY_REQUESTS_ERROR,
      retryAfterSeconds ? { retryAfterSeconds } : undefined
    );
  }
}
