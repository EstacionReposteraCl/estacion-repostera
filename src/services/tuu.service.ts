import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation, businessRule } from '../core/errors/index.ts';
import { seal, open } from '../core/crypto/secret-box.ts';
import { tuuClient, statusOf, TuuError, type HttpCall, type TuuStatus } from '../integrations/tuu.ts';
import type { UnitOfWork, IntegrationStore } from '../repositories/ports.ts';

const PURPOSE = 'integration:tuu';
const defaultCall: HttpCall = async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: 'no-store' }); return { status: r.status, text: () => r.text() }; };
export interface Deps { uow: UnitOfWork; integrations: IntegrationStore; call?: HttpCall; secret?: () => string }

/**
 * Cobro con la máquina TUU desde la Caja ("Modo Integración" / pago remoto): el sistema envía el monto a la máquina,
 * el cliente pasa la tarjeta y el sistema registra la venta y emite la boleta. Conectar: ADMINISTRADOR. Cobrar: quien vende.
 */
export function createTuuService({ uow, integrations, call = defaultCall, secret = () => process.env.BETTER_AUTH_SECRET ?? '' }: Deps) {
  async function config(): Promise<{ apiKey: string; device: string; enabled: boolean } | null> {
    const a = await integrations.latest('tuu'); if (!a) return null;
    const apiKey = typeof a.keyBox === 'string' ? open(a.keyBox, secret(), PURPOSE) : null; const device = typeof a.device === 'string' ? a.device : '';
    return apiKey && device ? { apiKey, device, enabled: a.enabled !== false } : null;
  }
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) {
      if (e instanceof TuuError) throw businessRule(e.message);
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw businessRule('TUU no respondió a tiempo. Revisa la máquina antes de reintentar.');
      throw e;
    }
  };
  return {
    async status(actor: Actor | null): Promise<{ configured: boolean; enabled: boolean; device: string | null; canConfigure: boolean }> {
      assertCan(actor, 'sale.create'); const c = await config(); const a = await integrations.latest('tuu');
      return { configured: !!c, enabled: !!c?.enabled, device: c?.device ?? (typeof a?.device === 'string' ? a.device : null), canConfigure: can(actor.role, 'settings.write') };
    },
    async connect(actor: Actor | null, i: { apiKey?: string; device: string; enabled: boolean }): Promise<void> {
      assertCan(actor, 'settings.write');
      const device = String(i.device ?? '').trim(); if (!/^[A-Za-z0-9-]{4,64}$/.test(device)) throw validation('N° de serie de la máquina inválido.');
      const prev = await config(); const key = String(i.apiKey ?? '').trim() || prev?.apiKey || '';
      if (key.length < 8 || /\s/.test(key)) throw validation('API Key de TUU inválida.');
      if (secret().length < 16) throw businessRule('El servidor no tiene configurado su secreto; no se pueden guardar credenciales.');
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'tuu', entityId: 'tuu', userId: actor.userId, after: { device, enabled: i.enabled !== false, keyBox: seal(key, secret(), PURPOSE) } }));
    },
    /** Envía el cobro a la máquina. La clave identifica el intento: reintentar con la misma clave nunca cobra dos veces. */
    async start(actor: Actor | null, i: { amount: number; method: 'DEBIT' | 'CREDIT' | null; key: string }): Promise<void> {
      assertCan(actor, 'sale.create');
      const c = await config(); if (!c?.enabled) throw businessRule('El cobro con la máquina TUU desde el sistema no está activado.');
      if (!Number.isSafeInteger(i.amount) || i.amount < 100) throw validation('TUU cobra desde $100.');
      if (!/^[A-Za-z0-9-]{8,36}$/.test(i.key)) throw validation('Clave de cobro inválida.');
      await wrap(() => tuuClient(c.apiKey, call).create({ amount: i.amount, device: c.device, idempotencyKey: i.key, paymentMethod: i.method === 'CREDIT' ? 1 : i.method === 'DEBIT' ? 2 : undefined, dteType: 48 }));
    },
    async check(actor: Actor | null, key: string): Promise<{ status: TuuStatus; detail: string | null }> {
      assertCan(actor, 'sale.create');
      const c = await config(); if (!c) throw businessRule('Falta conectar la máquina TUU.');
      const raw = await wrap(() => tuuClient(c.apiKey, call).get(String(key)));
      const r = raw as Record<string, unknown>; const msg = typeof r.message === 'string' ? r.message : null;
      return { status: statusOf(raw), detail: msg };
    },
  };
}
