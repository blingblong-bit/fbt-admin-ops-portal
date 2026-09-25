// Pure work-week helpers shared by the forecast and tests.
export function ymdWeekday(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Business week is Monday–Friday (5 days). Saturday and Sunday roll FORWARD
// into the upcoming work week: on Sat/Sun, `workWeekStartFromYmd` returns
// the next Monday, so weekend appointments/payments count toward next week.
// On Mon–Fri, it returns the Monday of the current work week.
export function workWeekStartFromYmd(ymd: string): string {
  const dow = ymdWeekday(ymd); // 0=Sun..6=Sat
  const offset = dow === 0 ? 1 : dow === 6 ? 2 : -(dow - 1);
  return addDaysYmd(ymd, offset);
}
