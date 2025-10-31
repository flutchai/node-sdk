/**
 * Utility functions for safe error handling in TypeScript
 * Handles the `unknown` type of errors in catch blocks
 */

/**
 * Type guard to check if value is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Safely extracts error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    // Check for common error object patterns
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Safely extracts stack trace from unknown error type
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  if (typeof error === "object" && error !== null && "stack" in error) {
    return String(error.stack);
  }
  return undefined;
}

/**
 * Formats unknown error into a structured object for logging
 */
export function formatError(error: unknown): {
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  details?: any;
} {
  if (error instanceof Error) {
    const formatted: any = {
      message: error.message,
      stack: error.stack,
    };

    // Handle common error properties
    if ("code" in error) formatted.code = (error as any).code;
    if ("statusCode" in error) formatted.statusCode = (error as any).statusCode;
    if ("response" in error) formatted.details = (error as any).response;

    return formatted;
  }

  if (typeof error === "string") {
    return { message: error };
  }

  if (typeof error === "object" && error !== null) {
    const formatted: any = {
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : JSON.stringify(error),
    };

    if ("stack" in error) formatted.stack = String(error.stack);
    if ("code" in error) formatted.code = String(error.code);
    if ("statusCode" in error && typeof error.statusCode === "number") {
      formatted.statusCode = error.statusCode;
    }

    return formatted;
  }

  return { message: String(error) };
}

/**
 * Formats error for production logging (without stack traces)
 */
export function formatErrorForProduction(error: unknown): {
  message: string;
  code?: string;
  statusCode?: number;
} {
  const formatted = formatError(error);
  // Remove stack trace for production
  delete formatted.stack;
  delete formatted.details;
  return formatted;
}

/**
 * Helper for logging errors with NestJS Logger
 * Usage: logError(this.logger, error, 'Failed to process payment');
 */
export function logError(
  logger: { error: (message: string, ...args: any[]) => void },
  error: unknown,
  context: string,
  additionalData?: Record<string, any>
): void {
  const errorInfo = formatError(error);

  logger.error(
    context,
    process.env.ENV === "prod"
      ? { ...formatErrorForProduction(error), ...additionalData }
      : { ...errorInfo, ...additionalData }
  );
}
