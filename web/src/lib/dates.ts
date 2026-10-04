/**
 * `iso` (YYYY-MM-DD) moved back by whole calendar months, clamping the day to the target month's
 * length: 31 Mar − 1 month = 28/29 Feb, 29 Feb 2024 − 12 months = 28 Feb 2023. (Date#setUTCMonth
 * would roll over into the next month instead.)
 */
export function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12; // 0-based
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}
