/** Value of `points` on each of `dates`, carrying the last known value forward (null before the first). */
export function alignTo(dates: string[], points: { date: string; value: number }[]): (number | null)[] {
  const out: (number | null)[] = new Array(dates.length).fill(null);
  let j = 0;
  let last: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    while (j < points.length && points[j].date <= dates[i]) last = points[j++].value;
    // 10 significant digits keeps the payload small without distorting restated NAVs (which can
    // have more than four decimals after a unit change).
    out[i] = last == null ? null : Number(last.toPrecision(10));
  }
  return out;
}
