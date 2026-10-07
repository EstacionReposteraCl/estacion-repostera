// Formato chileno. Montos en pesos enteros; cantidades como texto "12.500" (3 decimales) desde los DTO.
const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
export const peso = (n: number | null | undefined) => (n == null ? '—' : clp.format(n));
/** "12.500" (milésimas) -> "12,5"; "3.000" -> "3". */
export function qty(t: string | null | undefined): string {
  if (t == null) return '—';
  const [i, f = ''] = t.split('.'); const frac = f.replace(/0+$/, '');
  return Number(i).toLocaleString('es-CL') + (frac ? ',' + frac : '');
}
