import pino, { type Logger } from 'pino';

/**
 * Structured JSON logger (M14). Every line carries `service`; callers attach `correlationId`
 * per-request via `logger.child({ correlationId })` so a single request can be followed
 * end-to-end across services.
 */
export function createLogger(service: string): Logger {
  return pino({
    name: service,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}
