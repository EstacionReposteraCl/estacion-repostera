import type { Milli, Peso } from '../../core/money/rounding.ts';
import { parseQuantity, convertToBase, hasValidDecimals, type UnitDef } from '../../core/money/quantity.ts';
import { lineTotalPerBase, lineTotalPerPack, computeSaleTotals } from '../../core/money/iva.ts';
import { validation, forbidden, businessRule } from '../../core/errors/index.ts';
import type { Actor } from '../../core/permissions/permissions.ts';

export interface CatalogPresentation { id: string; name: string; baseQuantity: Milli; salePrice: Peso | null; isActive: boolean }
export interface CatalogProduct {
  id: string; sku: string; name: string; kind: 'GOODS' | 'SERVICE'; isActive: boolean; vatTreatment: 'AFECTO' | 'EXENTO';
  salePrice: Peso; unit: UnitDef; presentations: CatalogPresentation[];
}
/** Lo que el cliente puede enviar. NO existe unitPrice ni discount para el vendedor: si llegan, se rechazan. */
export interface SaleLineInput { productId: string; presentationId?: string | null; quantity: string; unitCode?: string; manualUnitPrice?: Peso; discount?: unknown }
export interface SaleInput { lines: SaleLineInput[]; channelId: string; payments: { methodId: string; amount: Peso; reference?: string }[]; idempotencyKey: string; externalRef?: string | null; note?: string | null;
  /** Solo ADMINISTRADOR: fecha contable pasada (AAAA-MM-DD) para registrar ventas atrasadas, p. ej. comprobantes de TUU. */
  saleDate?: string | null }

export interface SaleLinePlan {
  lineNumber: number; productId: string; kind: 'GOODS' | 'SERVICE'; presentationId: string | null; presentationBaseQuantity: Milli | null;
  skuSnapshot: string; nameSnapshot: string; baseUnitSnapshot: string; enteredQuantity: Milli; enteredUnit: string; quantity: Milli;
  priceBasis: 'PER_BASE_UNIT' | 'PER_PRESENTATION'; unitPrice: Peso; isManualPrice: boolean; vatTreatment: 'AFECTO' | 'EXENTO'; vatRate: number;
  lineTotal: Peso; lineNet: Peso; lineVat: Peso;
}
export interface SalePlan { lines: SaleLinePlan[]; total: Peso; net: Peso; vat: Peso; stockDemand: Map<string, Milli> }

export interface PlanContext { actor: Actor; products: Map<string, CatalogProduct>; units: Map<string, UnitDef>; vatRate?: number }

export function planSale(input: SaleInput, ctx: PlanContext): SalePlan {
  if (!input.idempotencyKey?.trim()) throw validation('Falta la clave de idempotencia.');
  if (input.lines.length === 0) throw validation('La venta debe tener al menos una línea.');
  const rate = ctx.vatRate ?? 19;
  const lines: SaleLinePlan[] = [];
  input.lines.forEach((l, idx) => {
    if (l.discount !== undefined) throw forbidden('No se permiten descuentos.');
    const isAdmin = ctx.actor.role === 'ADMINISTRADOR';
    if (l.manualUnitPrice !== undefined && !isAdmin) throw forbidden('No puedes modificar precios.');
    if (l.manualUnitPrice !== undefined && (!Number.isSafeInteger(l.manualUnitPrice) || l.manualUnitPrice <= 0)) throw validation('El precio manual debe ser un entero en pesos mayor que 0.');
    const p = ctx.products.get(l.productId);
    if (!p) throw validation('Producto inexistente.');
    if (!p.isActive) throw businessRule(`El producto "${p.name}" está inactivo o archivado.`);
    let entered: Milli;
    try { entered = parseQuantity(l.quantity); } catch { throw validation(`Cantidad inválida para "${p.name}".`); }
    if (entered <= 0n) throw validation(`La cantidad de "${p.name}" debe ser mayor que 0.`);
    const base = {
      lineNumber: idx + 1, productId: p.id, kind: p.kind, skuSnapshot: p.sku, nameSnapshot: p.name, baseUnitSnapshot: p.unit.code,
      vatTreatment: p.vatTreatment, vatRate: p.vatTreatment === 'AFECTO' ? rate : 0, isManualPrice: l.manualUnitPrice !== undefined,
    };
    if (l.presentationId) {
      if (p.kind !== 'GOODS') throw validation('Un servicio no tiene presentaciones.');
      const pr = p.presentations.find((x) => x.id === l.presentationId);
      if (!pr) throw validation('La presentación no pertenece a este producto.');
      if (!pr.isActive) throw businessRule(`La presentación "${pr.name}" está inactiva.`);
      if (entered % 1000n !== 0n) throw validation(`"${pr.name}": las presentaciones se venden en envases enteros.`);
      const perPack = l.manualUnitPrice ?? pr.salePrice ?? lineTotalPerBase(pr.baseQuantity, p.salePrice);
      const total = lineTotalPerPack(entered, perPack);
      lines.push({ ...base, presentationId: pr.id, presentationBaseQuantity: pr.baseQuantity, enteredQuantity: entered, enteredUnit: pr.name,
        quantity: (entered / 1000n) * pr.baseQuantity, priceBasis: 'PER_PRESENTATION', unitPrice: perPack, lineTotal: total, lineNet: 0, lineVat: 0 });
    } else {
      const from = l.unitCode ? ctx.units.get(l.unitCode) : p.unit;
      if (!from) throw validation('Unidad desconocida.');
      if (!hasValidDecimals(entered, from.maxDecimals)) throw validation(`"${p.name}": la unidad ${from.code} admite ${from.maxDecimals} decimales.`);
      const qty = from.code === p.unit.code ? entered : convertToBase(entered, from, p.unit);
      if (qty <= 0n) throw validation(`La cantidad de "${p.name}" es demasiado pequeña.`);
      if (!hasValidDecimals(qty, p.unit.maxDecimals)) throw validation(`"${p.name}": cantidad no válida para su unidad base.`);
      const price = l.manualUnitPrice ?? p.salePrice;
      lines.push({ ...base, presentationId: null, presentationBaseQuantity: null, enteredQuantity: entered, enteredUnit: from.code, quantity: qty,
        priceBasis: 'PER_BASE_UNIT', unitPrice: price, lineTotal: lineTotalPerBase(qty, price), lineNet: 0, lineVat: 0 });
    }
  });
  const t = computeSaleTotals(lines.map((l) => ({ total: l.lineTotal, taxable: l.vatTreatment === 'AFECTO' })), Math.round(rate * 100));
  lines.forEach((l, i) => { l.lineNet = t.lines[i].net; l.lineVat = t.lines[i].vat; });
  const paid = input.payments.reduce((s, p) => s + p.amount, 0);
  if (input.payments.length === 0 || input.payments.some((p) => !Number.isSafeInteger(p.amount) || p.amount <= 0)) throw validation('Indica el medio de pago.');
  if (paid !== t.total) throw validation(`Los pagos (${paid}) no cuadran con el total (${t.total}).`);
  const stockDemand = new Map<string, Milli>();
  for (const l of lines) if (l.kind === 'GOODS') stockDemand.set(l.productId, (stockDemand.get(l.productId) ?? 0n) + l.quantity);
  return { lines, total: t.total, net: t.net, vat: t.vat, stockDemand };
}
