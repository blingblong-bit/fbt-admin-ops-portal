import { amountOwed, type Client } from "./clients";

export type WeeklyBucket = "this" | "next";

export type WeeklyRenewalForecast = {
  client_id: string;
  week_bucket: "this" | "next" | "later";
  next_package_price: number;
  pre_renewed: boolean;
  first_uncovered_ymd: string;
  pending_start_ymd: string | null;
};

export type WeeklyPaymentRow = {
  client: Client;
  currentAmount: number;
  nextAmount: number;
  forecast?: WeeklyRenewalForecast;
};

export type WeeklyPaymentGroups = {
  current: WeeklyPaymentRow[];
  renewalScheduled: WeeklyPaymentRow[];
  needsRenewal: WeeklyPaymentRow[];
  totals: {
    current: number;
    renewalScheduled: number;
    needsRenewal: number;
    nextPackage: number;
    combined: number;
  };
};

export function groupWeeklyPayments(
  clients: Client[],
  forecasts: Map<string, WeeklyRenewalForecast>,
  bucket: WeeklyBucket,
  isCurrentDue: (client: Client) => boolean,
): WeeklyPaymentGroups {
  const current: WeeklyPaymentRow[] = [];
  const renewalScheduled: WeeklyPaymentRow[] = [];
  const needsRenewal: WeeklyPaymentRow[] = [];

  for (const client of clients) {
    const currentAmount = isCurrentDue(client) ? amountOwed(client) : 0;
    const forecast = forecasts.get(client.id);
    const nextAmount = forecast?.week_bucket === bucket ? forecast.next_package_price : 0;
    const row = { client, currentAmount, nextAmount, forecast };

    if (currentAmount > 0) current.push(row);
    if (nextAmount > 0 && forecast?.pre_renewed) renewalScheduled.push(row);
    if (nextAmount > 0 && forecast && !forecast.pre_renewed) needsRenewal.push(row);
  }

  const byCurrentAmount = (a: WeeklyPaymentRow, b: WeeklyPaymentRow) =>
    b.currentAmount - a.currentAmount;
  const byRenewalDate = (a: WeeklyPaymentRow, b: WeeklyPaymentRow) =>
    (a.forecast?.pending_start_ymd ?? a.forecast?.first_uncovered_ymd ?? "").localeCompare(
      b.forecast?.pending_start_ymd ?? b.forecast?.first_uncovered_ymd ?? "",
    );
  current.sort(byCurrentAmount);
  renewalScheduled.sort(byRenewalDate);
  needsRenewal.sort(byRenewalDate);

  const currentTotal = current.reduce((sum, row) => sum + row.currentAmount, 0);
  const scheduledTotal = renewalScheduled.reduce((sum, row) => sum + row.nextAmount, 0);
  const needsTotal = needsRenewal.reduce((sum, row) => sum + row.nextAmount, 0);

  return {
    current,
    renewalScheduled,
    needsRenewal,
    totals: {
      current: currentTotal,
      renewalScheduled: scheduledTotal,
      needsRenewal: needsTotal,
      nextPackage: scheduledTotal + needsTotal,
      combined: currentTotal + scheduledTotal + needsTotal,
    },
  };
}