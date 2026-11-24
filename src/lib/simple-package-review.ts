export const DISMISS_ACTIVITY = "package_review_dismissed";
export const UNDISMISS_ACTIVITY = "package_review_redo";

export function packageReviewDismissals(rows: readonly { client_id: string; activity_type: string; created_at: string }[]) {
  const latest = new Map<string, string>();
  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(row.client_id, row.activity_type);
  return new Set([...latest].filter(([, type]) => type === DISMISS_ACTIVITY).map(([id]) => id));
}

export function simplePackageClientIds(rows: readonly { client_id: string; deleted_at: string | null }[]) {
  return new Set(rows.filter(row => !row.deleted_at).map(row => row.client_id));
}