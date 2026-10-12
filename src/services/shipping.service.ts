import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation, businessRule } from '../core/errors/index.ts';
import { seal, open } from '../core/crypto/secret-box.ts';
import { jumpsellerClient, JumpsellerError, type HttpGet, type JsCredentials, type OrderRow, type ShippingLabel } from '../integrations/jumpseller.ts';
import type { UnitOfWork, IntegrationStore } from '../repositories/ports.ts';

const PURPOSE = 'integration:jumpseller';
const defaultGet: HttpGet = async (url, headers) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(12_000), cache: 'no-store' });
  return { status: r.status, json: () => r.json() };
};
export interface Deps { uow: UnitOfWork; integrations: IntegrationStore; get?: HttpGet; secret?: () => string }

/**
 * Etiquetas de despacho de pedidos de Jumpseller para la impresora térmica.
 * Credenciales (login + token de la API de Jumpseller): solo ADMINISTRADOR; se guardan cifradas en la bitácora
 * ('integration.set', entidad 'jumpseller'). Imprimir etiquetas: administrador y vendedor.
 */
export function createShippingService({ uow, integrations, get = defaultGet, secret = () => process.env.BETTER_AUTH_SECRET ?? '' }: Deps) {
  async function creds(): Promise<JsCredentials | null> {
    const a = await integrations.latest('jumpseller'); if (!a) return null;
    const login = typeof a.login === 'string' ? a.login : ''; const box = typeof a.tokenBox === 'string' ? a.tokenBox : '';
    const token = box ? open(box, secret(), PURPOSE) : null;
    return login && token ? { login, token } : null;
  }
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) {
      if (e instanceof JumpsellerError) throw businessRule(e.message);
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw businessRule('Jumpseller no respondió a tiempo. Intenta de nuevo.');
      throw e;
    }
  };
  async function client(actor: Actor) {
    void actor; const c = await creds();
    if (!c) throw businessRule('Falta conectar Jumpseller (login y token de la API).');
    return jumpsellerClient(c, get);
  }
  return {
    async status(actor: Actor | null): Promise<{ configured: boolean; login: string | null; canConfigure: boolean }> {
      assertCan(actor, 'shipping.labels');
      const a = await integrations.latest('jumpseller'); const c = await creds();
      return { configured: !!c, login: c ? c.login : (typeof a?.login === 'string' ? a.login : null), canConfigure: can(actor.role, 'settings.write') };
    },
    /** Guarda (o reemplaza) las credenciales después de comprobarlas contra Jumpseller. */
    async connect(actor: Actor | null, i: { login: string; token: string }): Promise<void> {
      assertCan(actor, 'settings.write');
      const login = String(i.login ?? '').trim(); const token = String(i.token ?? '').trim();
      if (login.length < 3 || login.length > 200 || /\s/.test(login)) throw validation('Login de la API inválido.');
      if (token.length < 8 || token.length > 500 || /\s/.test(token)) throw validation('Token de la API inválido.');
      if (secret().length < 16) throw businessRule('El servidor no tiene configurado su secreto; no se pueden guardar credenciales.');
      await wrap(() => jumpsellerClient({ login, token }, get).recent(1));
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'jumpseller', entityId: 'jumpseller', userId: actor.userId, after: { login, tokenBox: seal(token, secret(), PURPOSE) } }));
    },
    async recent(actor: Actor | null): Promise<OrderRow[]> { assertCan(actor, 'shipping.labels'); const c = await client(actor); return wrap(() => c.recent(30)); },
    async order(actor: Actor | null, id: number): Promise<ShippingLabel> {
      assertCan(actor, 'shipping.labels');
      if (!Number.isSafeInteger(id) || id <= 0) throw validation('N° de pedido inválido.');
      const c = await client(actor); return wrap(() => c.order(id));
    },
  };
}
