/**
 * Standardized API Error Class
 * Provides machine-readable error codes, HTTP status, and retryability semantics.
 */
class ApiError extends Error {
  constructor({
    message,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    retryable = false,
    details = null,
  }) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad Request", code = "INVALID_INPUT", details = null) {
    return new ApiError({ message, statusCode: 400, code, retryable: false, details });
  }

  static unauthorized(message = "Unauthorized access", code = "UNAUTHORIZED") {
    return new ApiError({ message, statusCode: 401, code, retryable: false });
  }

  static forbidden(message = "Access forbidden", code = "FORBIDDEN") {
    return new ApiError({ message, statusCode: 403, code, retryable: false });
  }

  static notFound(message = "Resource not found", code = "NOT_FOUND") {
    return new ApiError({ message, statusCode: 404, code, retryable: false });
  }

  static conflict(message = "Conflict", code = "CONFLICT") {
    return new ApiError({ message, statusCode: 409, code, retryable: false });
  }

  static rateLimited(message = "Rate limit exceeded", code = "RATE_LIMITED", retryAfterSeconds = 60) {
    return new ApiError({
      message,
      statusCode: 429,
      code,
      retryable: true,
      details: { retryAfterSeconds }
    });
  }

  static providerTimeout(message = "AI provider request timed out", code = "PROVIDER_TIMEOUT") {
    return new ApiError({ message, statusCode: 504, code, retryable: true });
  }

  static providerUnavailable(message = "AI provider currently unavailable", code = "PROVIDER_UNAVAILABLE") {
    return new ApiError({ message, statusCode: 503, code, retryable: true });
  }

  static internal(message = "Internal Server Error", code = "INTERNAL_ERROR") {
    return new ApiError({ message, statusCode: 500, code, retryable: false });
  }
}

module.exports = ApiError;
