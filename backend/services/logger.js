/**
 * Structured logging helpers with a minimal error taxonomy.
 *
 * error_kind values:
 *   validation | auth | not_found | conflict | external | timeout | internal
 */

export function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error || 'Unknown error');
  const code = String(error?.code || '');

  if (status === 400 || /invalid|required|must be/i.test(message)) return 'validation';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'external';
  if (status === 502 || status === 503) return 'external';
  if (/timeout|timed out|abort/i.test(message) || code === 'ABORT_ERR') return 'timeout';
  if (status >= 500) return 'internal';
  return 'internal';
}

export function logInfo(event, fields = {}) {
  console.log(JSON.stringify({ level: 'info', event, ...fields }));
}

export function logWarn(event, fields = {}) {
  console.warn(JSON.stringify({ level: 'warn', event, ...fields }));
}

export function logError(event, error, fields = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      error_kind: classifyError(err),
      message: err.message,
      status: err.status || null,
      code: err.code || null,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      ...fields,
    }),
  );
}
