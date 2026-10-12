// Simulador de precios por canal. Mismas reglas que la ganancia real del sistema:
// ganancia = venta neta (sin IVA si el producto es afecto) − costo − comisiones del canal/medio de pago.
export interface ChannelFee { percent: number; fixed: number }
export interface SimInput { price: number; discountPct: number; cost: number; exempt: boolean; fee: ChannelFee }
export interface SimResult { finalPrice: number; net: number; iva: number; fee: number; cost: number; profit: number; marginPct: number | null }

export const VAT = 1.19;

export function simulate(i: SimInput): SimResult {
  const finalPrice = Math.max(Math.round(i.price * (1 - clampPct(i.discountPct) / 100)), 0);
  const net = i.exempt ? finalPrice : Math.round(finalPrice / VAT);
  const fee = finalPrice > 0 ? Math.round(finalPrice * (i.fee.percent / 100) + i.fee.fixed) : 0;
  const profit = net - i.cost - fee;
  return { finalPrice, net, iva: finalPrice - net, fee, cost: i.cost, profit, marginPct: net > 0 ? (profit / net) * 100 : null };
}

/** Precio con IVA para lograr un margen (% sobre la venta neta). null si la comisión hace imposible ese margen. */
export function priceForMargin(cost: number, marginPct: number, exempt: boolean, fee: ChannelFee): number | null {
  const v = exempt ? 1 : VAT; const k = (1 - marginPct / 100) / v - fee.percent / 100;
  if (k <= 0) return null;
  return (cost + fee.fixed) / k;
}

/** Redondea hacia arriba a un precio "de vitrina" terminado en 90 (4.990, 12.490…). Bajo $1.000, a la decena. */
export function roundPrice(p: number): number {
  if (p <= 0) return 0;
  if (p < 1000) return Math.ceil(p / 10) * 10;
  return Math.ceil((p + 10) / 100) * 100 - 10;
}

export function clampPct(p: number): number { return Number.isFinite(p) ? Math.min(Math.max(p, 0), 100) : 0; }
