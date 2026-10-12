import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation, businessRule, notFound } from '../core/errors/index.ts';
import { seal, open } from '../core/crypto/secret-box.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { openFacturaClient, buildBoleta, medioPagoFor, OpenFacturaError, type HttpCall, type OfEnv, type OfOrg } from '../integrations/openfactura.ts';
import type { UnitOfWork, IntegrationStore, CatalogReader } from '../repositories/ports.ts';

const PURPOSE = 'integration:openfactura';
const CARD = ['DEBIT', 'CREDIT', 'HISTORICO_TUU'];
const defaultCall: HttpCall = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000), cache: 'no-store' });
  return { status: r.status, text: () => r.text() };
};
const milliToNumber = (m: bigint) => Number(m) / 1000;

/** Boleta emitida (bitácora: action 'dte.issue', entidad Sale). Es lo que se imprime y se reimprime. */
export interface BoletaRecord {
  tipo: 39; folio: number; token: string; fecha: string; env: OfEnv; total: number; neto: number; iva: number; exento: number; medioPago: number | null;
  lines: { name: string; qty: number; lineTotal: number }[]; emisor: OfOrg; resolucion: { fecha: string; numero: number }; timbre: string | null; warning: string | null; saleFolio: number;
}
export interface Deps {
  uow: UnitOfWork; integrations: IntegrationStore; catalog: CatalogReader; now?: () => Date;
  /** Verifica que el actor puede ver la venta (vendedor: solo las suyas de hoy). */
  canSee: (actor: Actor, saleId: string) => Promise<unknown>;
  call?: HttpCall; secret?: () => string;
}

/**
 * Boleta electrónica (39) emitida desde el sistema con la API de OpenFactura (Haulmer).
 * Conectar (API Key, cifrada en la bitácora): solo ADMINISTRADOR. Emitir y reimprimir: quien puede ver la venta.
 */
export function createDteService({ uow, integrations, catalog, canSee, now = () => new Date(), call = defaultCall, secret = () => process.env.BETTER_AUTH_SECRET ?? '' }: Deps) {
  async function config(): Promise<{ apiKey: string; env: OfEnv; org: OfOrg } | null> {
    const a = await integrations.latest('openfactura'); if (!a) return null;
    const apiKey = typeof a.keyBox === 'string' ? open(a.keyBox, secret(), PURPOSE) : null;
    const env: OfEnv = a.env === 'dev' ? 'dev' : 'prod';
    return apiKey && a.org ? { apiKey, env, org: a.org as OfOrg } : null;
  }
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) {
      if (e instanceof OpenFacturaError) throw businessRule(e.code === 'OF-06' ? 'Esta boleta ya se envió a Haulmer hace un momento. Recarga la página en unos segundos.' : e.message);
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw businessRule('Haulmer no respondió a tiempo. Revisa en el Espacio de Trabajo si la boleta quedó emitida antes de reintentar.');
      throw e;
    }
  };
  const existing = async (saleId: string) => (await integrations.latestEntry('dte.issue', 'Sale', saleId)) as BoletaRecord | null;

  return {
    async status(actor: Actor | null): Promise<{ configured: boolean; env: OfEnv | null; emisor: { rut: string; razonSocial: string } | null; canConfigure: boolean }> {
      assertCan(actor, 'dte.issue'); const c = await config();
      return { configured: !!c, env: c?.env ?? null, emisor: c ? { rut: c.org.rut, razonSocial: c.org.razonSocial } : null, canConfigure: can(actor.role, 'settings.write') };
    },
    /** Guarda la API Key después de comprobarla (lee los datos del emisor en Haulmer). */
    async connect(actor: Actor | null, i: { apiKey: string; env?: string }): Promise<OfOrg> {
      assertCan(actor, 'settings.write');
      const apiKey = String(i.apiKey ?? '').trim(); const env: OfEnv = i.env === 'dev' ? 'dev' : 'prod';
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(apiKey)) throw validation('API Key inválida.');
      if (secret().length < 16) throw businessRule('El servidor no tiene configurado su secreto; no se pueden guardar credenciales.');
      const org = await wrap(() => openFacturaClient(apiKey, env, call).organization());
      if (!org.rut || !org.razonSocial || !org.giro || !org.direccion || !org.comuna) throw businessRule('Haulmer no devolvió los datos completos del emisor (RUT, razón social, giro, dirección y comuna).');
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'openfactura', entityId: 'openfactura', userId: actor.userId, after: { env, keyBox: seal(apiKey, secret(), PURPOSE), org } }));
      return org;
    },
    async forSale(actor: Actor | null, saleId: string): Promise<BoletaRecord | null> {
      assertCan(actor, 'dte.issue'); await canSee(actor, String(saleId)); return existing(String(saleId));
    },
    /** Emite la boleta de una venta (una sola vez). Las ventas con tarjeta (TUU ya emite boleta) exigen confirmación. */
    async issueBoleta(actor: Actor | null, saleId: string, opts: { allowCard?: boolean } = {}): Promise<BoletaRecord> {
      assertCan(actor, 'dte.issue'); saleId = String(saleId);
      await canSee(actor, saleId);
      const prev = await existing(saleId); if (prev) throw businessRule(`Esta venta ya tiene la boleta N° ${prev.folio}.`);
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer (API Key) para emitir boletas.');
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
      if (got.sale.status !== 'COMPLETED') throw businessRule('No se puede emitir boleta de una venta anulada.');
      const methods = new Map((await catalog.listPaymentMethods()).map((m) => [m.id, m.code]));
      const codes = [...got.payments].sort((a, b) => b.amount - a.amount).map((p) => methods.get(p.methodId) ?? '');
      if (codes.some((x) => CARD.includes(x)) && !opts.allowCard) throw businessRule('Esta venta se pagó con tarjeta en la máquina TUU, que ya emite su boleta. Confirma solo si TUU no la emitió.');
      const fecha = businessDateOf(now(), (await catalog.businessSettings()).timezone);
      const lines = got.items.map((it) => ({ name: it.nameSnapshot, qty: milliToNumber(it.enteredQuantity), lineTotal: it.lineTotal, exempt: it.vatTreatment === 'EXENTO' }));
      let built; try { built = buildBoleta(c.org, fecha, lines, medioPagoFor(codes)); } catch (e) { throw businessRule((e as Error).message); }
      const r = await wrap(() => openFacturaClient(c.apiKey, c.env, call).emit(built.dte, `ER-${c.env}-${saleId}`));
      const rec: BoletaRecord = { tipo: 39, folio: r.folio, token: r.token, fecha, env: c.env, ...built.totals, medioPago: medioPagoFor(codes) ?? null,
        lines: lines.filter((l) => l.lineTotal > 0 && l.qty > 0).map(({ name, qty, lineTotal }) => ({ name, qty, lineTotal })), emisor: c.org,
        resolucion: r.resolucion ?? c.org.resolucion, timbre: r.timbre, warning: r.warning, saleFolio: got.sale.folio };
      await uow.run((tx) => tx.audit.write({ action: 'dte.issue', entity: 'Sale', entityId: saleId, userId: actor.userId, after: rec }));
      return rec;
    },
  };
}
