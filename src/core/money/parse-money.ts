import { validation } from '../errors/index.ts';

/**
 * Monto escrito al estilo chileno -> CENTAVOS (entero) o null si no es válido.
 *   "1.508,50" -> 150850 · "1508,5" -> 150850 · "$ 1.508" -> 150800 · "1508.50" -> 150850 · "12.345.678" -> 1234567800
 * Coma = decimal. Sin coma, un punto seguido de 1–2 dígitos al final es decimal; puntos seguidos de 3 dígitos son miles.
 */
export function parseMoneyCents(raw: string): number | null {
  const t = raw.replace(/[$\s]/g, "");
  if (!t) return null;
  let int: string, dec = "";
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})$/.exec(t);
  if (m) { int = m[1].replace(/\./g, ""); dec = m[2]; }
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(t) || /^\d+$/.test(t)) int = t.replace(/\./g, "");
  else { const d = /^(\d+)\.(\d{1,2})$/.exec(t); if (!d) return null; int = d[1]; dec = d[2]; }
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "1,5" / "1.5" / "0" -> milésimas de punto porcentual (1500). Rango 0–100 %, máx. 3 decimales. */
export function parsePercent(text: string): number {
  const t = text.trim().replace(',', '.'); const m = /^(\d{1,3})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) throw validation('Porcentaje inválido (ej.: 1,5).');
  const v = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0');
  if (v > 100_000) throw validation('El porcentaje no puede superar 100 %.');
  return v;
}
