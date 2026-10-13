/**
 * Pure archive-eligibility rules. A client may be archived only when Square
 * scheduling was verified AND they have no active appointment at/after now.
 * Active = start_at >= now and status is not cancelled / declined / no-show.
 */
export type ArchiveBooking = { start_at?: string | null; status?: string | null };

export const ARCHIVE_BLOCKED_SCHEDULED = "Cannot archive — client is currently scheduled in Square.";
export const ARCHIVE_BLOCKED_UNVERIFIED = "Square scheduling status could not be verified.";

const INACTIVE_STATUS = /CANCEL|DECLIN|NO_SHOW/i;

export function isActiveUpcoming(b: ArchiveBooking, nowMs: number): boolean {
  if (!b.start_at) return false;
  const t = new Date(b.start_at).getTime();
  if (!Number.isFinite(t) || t < nowMs) return false;
  return !INACTIVE_STATUS.test(b.status ?? "");
}

export type ArchiveDecision =
  | { allowed: true; reason: null; upcoming: 0 }
  | { allowed: false; reason: string; upcoming: number };

export function decideArchive(
  verified: boolean,
  bookings: ArchiveBooking[],
  now: Date = new Date(),
): ArchiveDecision {
  if (!verified) return { allowed: false, reason: ARCHIVE_BLOCKED_UNVERIFIED, upcoming: 0 };
  const n = bookings.filter((b) => isActiveUpcoming(b, now.getTime())).length;
  if (n > 0) return { allowed: false, reason: ARCHIVE_BLOCKED_SCHEDULED, upcoming: n };
  return { allowed: true, reason: null, upcoming: 0 };
}

/** The only column archiving/restoring writes on the client row. */
export function archiveUpdatePayload(archive: boolean): { status: "archived" | "active" } {
  return { status: archive ? "archived" : "active" };
}
