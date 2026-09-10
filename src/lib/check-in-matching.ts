export type LooseVisitProbe = {
  booking_id: string;
  client_id?: string | null;
  appointment_ymd?: string | null;
};

export type LooseVisit = {
  client_id: string;
  visit_ymd: string;
};

/**
 * Match booking-less visits only within the same client and clinic day.
 * Each visit covers at most one appointment, preserving legitimate multiple
 * appointments on the same day without shifting visits across dates.
 */
export function matchLooseVisitBookingIds(
  probes: LooseVisitProbe[],
  visits: LooseVisit[],
): Set<string> {
  const budget = new Map<string, number>();
  for (const visit of visits) {
    const key = `${visit.client_id}|${visit.visit_ymd}`;
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }

  const matched = new Set<string>();
  const ordered = [...probes].sort((a, b) =>
    (a.appointment_ymd ?? "").localeCompare(b.appointment_ymd ?? ""),
  );
  for (const probe of ordered) {
    if (!probe.client_id || !probe.appointment_ymd) continue;
    const key = `${probe.client_id}|${probe.appointment_ymd}`;
    const remaining = budget.get(key) ?? 0;
    if (remaining < 1) continue;
    matched.add(probe.booking_id);
    budget.set(key, remaining - 1);
  }
  return matched;
}