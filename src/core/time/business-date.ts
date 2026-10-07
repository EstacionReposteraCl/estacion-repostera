/** Día calendario "YYYY-MM-DD" de un instante en la zona del negocio (por defecto America/Santiago). */
export function businessDateOf(instant: Date, timeZone = 'America/Santiago'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
