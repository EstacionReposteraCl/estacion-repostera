// Logger con redacción. Nunca registra contraseñas, tokens ni costos/márgenes.
const REDACT = new Set(['password', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'secret', 'authorization', 'cookie',
  'cost', 'inventoryvalue', 'grossprofit', 'realprofit', 'totalcharges', 'costofgoodssold', 'linecost']);
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogSink { write(line: string): void }

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = REDACT.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}
export function createLogger(sink: LogSink = { write: (l) => console.log(l) }, now: () => Date = () => new Date()) {
  const log = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) =>
    sink.write(JSON.stringify({ t: now().toISOString(), level, msg, ...(ctx ? { ctx: redact(ctx) } : {}) }));
  return { debug: (m: string, c?: Record<string, unknown>) => log('debug', m, c), info: (m: string, c?: Record<string, unknown>) => log('info', m, c),
    warn: (m: string, c?: Record<string, unknown>) => log('warn', m, c), error: (m: string, c?: Record<string, unknown>) => log('error', m, c) };
}
export type Logger = ReturnType<typeof createLogger>;
