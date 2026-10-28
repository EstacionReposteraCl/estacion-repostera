// Pago remoto de TUU (Haulmer): el sistema envía el monto a la máquina en "Modo Integración" y consulta el resultado.
// Docs: developers.tuu.cl/docs/pago-remoto · header X-API-Key (Espacio de Trabajo → Pagos → Configuración → API).
export const TUU_BASE = 'https://integrations.payment.haulmer.com';
export type HttpCall = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: () => Promise<string> }>;
export type TuuStatus = 'pending' | 'sent' | 'processing' | 'completed' | 'failed' | 'canceled' | 'unknown';
export class TuuError extends Error { readonly status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const NUM: Record<number, TuuStatus> = { 0: 'pending', 1: 'sent', 2: 'canceled', 3: 'processing', 4: 'failed', 5: 'completed' };
/** Estado de la solicitud, tolerante al formato (número o texto, en distintos lugares de la respuesta). */
export function statusOf(raw: unknown): TuuStatus {
  const r = o(raw); const d = o(r.data ?? r.Data ?? r.paymentRequest ?? r.PaymentRequest);
  const v = r.status ?? r.Status ?? d.status ?? d.Status ?? r.state ?? d.state;
  if (typeof v === 'number') return NUM[v] ?? 'unknown';
  const t = String(v ?? '').toLowerCase();
  if (/^\d+$/.test(t)) return NUM[Number(t)] ?? 'unknown';
  if (/complet|success|aprob|approved/.test(t)) return 'completed';
  if (/cancel/.test(t)) return 'canceled';
  if (/fail|error|rechaz|declin/.test(t)) return 'failed';
  if (/process/.test(t)) return 'processing';
  if (/sent|enviad/.test(t)) return 'sent';
  if (/pend/.test(t)) return 'pending';
  return 'unknown';
}

export function tuuClient(apiKey: string, call: HttpCall) {
  const req = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const r = await call(TUU_BASE + path, { method, headers: { 'X-API-Key': apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text(); let j: unknown = {}; try { j = JSON.parse(text); } catch { j = { message: text }; }
    if (r.status === 401 || r.status === 403) throw new TuuError('TUU rechazó la API Key.', r.status);
    if (r.status === 429) throw new TuuError('La máquina TUU recibió demasiadas solicitudes: espera un minuto e intenta de nuevo.', 429);
    if (r.status >= 400) { const m = o(j); throw new TuuError(`TUU respondió con error (${r.status})${m.message ? `: ${String(m.message)}` : ''}.`, r.status); }
    return j;
  };
  return {
    /** Envía el cobro a la máquina. dteType 48 = solo comprobante de pago (la boleta la emite el sistema). */
    async create(i: { amount: number; device: string; idempotencyKey: string; paymentMethod?: 1 | 2; description?: string; dteType?: number }) {
      return req('POST', '/RemotePayment/v2/Create', { idempotencyKey: i.idempotencyKey, amount: i.amount, device: i.device, description: i.description ?? 'Venta Estación Repostera',
        dteType: i.dteType ?? 48, ...(i.paymentMethod ? { paymentMethod: i.paymentMethod } : {}), extradata: { sourceName: 'Estacion Repostera', sourceVersion: '1' } });
    },
    async get(idempotencyKey: string) { return req('GET', `/RemotePayment/v2/GetPaymentRequest/${encodeURIComponent(idempotencyKey)}`); },
  };
}
