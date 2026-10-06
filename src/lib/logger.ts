import pino, { type Logger } from 'pino';

/**
 * Paths redacted from every log line. Personal data and secrets must never reach logs;
 * log identifiers (user id, lead id, request id) instead.
 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'headers.cookie',
  'headers.authorization',
  '*.headers.cookie',
  '*.headers.authorization',
];

function createLogger(): Logger {
  const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  return pino({
    level,
    base: { service: process.env.SERVICE_NAME ?? 'web' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

const globalForLogger = globalThis as unknown as { __pcLogger?: Logger };

export const logger: Logger = (globalForLogger.__pcLogger ??= createLogger());

export type { Logger };
