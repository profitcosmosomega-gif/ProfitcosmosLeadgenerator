import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** An error that is safe to expose to API clients. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.status = STATUS_BY_CODE[code];
  }
}

export const Errors = {
  validation: (message = 'Invalid request', details?: unknown) =>
    new AppError('VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') =>
    new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError('NOT_FOUND', message),
  conflict: (message = 'Resource conflict') => new AppError('CONFLICT', message),
  unavailable: (message = 'Service unavailable') => new AppError('SERVICE_UNAVAILABLE', message),
};

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Map any thrown value to an HTTP status and a client-safe envelope.
 * Unknown errors never leak their message or stack.
 */
export function toErrorResponse(
  error: unknown,
  requestId?: string,
): { status: number; body: ErrorEnvelope } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          requestId,
        },
      },
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } },
  };
}
