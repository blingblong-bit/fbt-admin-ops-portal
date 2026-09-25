import type { VisitTracking } from "@/lib/effective-visit-state";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

/** Visit count + where it comes from. Square clients read "No action required". */
export function VisitSourceLine({ visit, compact = false }: { visit: VisitTracking; compact?: boolean }) {
  const count = visit.total > 0 ? `${visit.used}/${visit.total}` : "—";
  const square = visit.mode === "square" || visit.mode === "square_review";
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-800">{count}</span>
        <span
          className={`rounded-full border px-1.5 py-0 text-[10px] font-semibold ${
            square
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : visit.mode === "held"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {square ? "Square synced" : visit.mode === "held" ? "Square position unclear" : "Hub fallback"}
        </span>
        {(visit.mode === "square_review" || visit.mode === "held") && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold text-amber-800">
            Needs review
          </span>
        )}
      </div>
      {square ? (
        <div className="text-muted-foreground">
          {visit.lastVisitDate ? `Last visit: ${shortDate(visit.lastVisitDate)}` : null}
          {visit.nextNote && visit.nextDate
            ? `${visit.lastVisitDate ? " · " : ""}Next: ${visit.nextNote} — ${shortDate(visit.nextDate)}`
            : null}
          {!compact && <span className="block text-emerald-700">No action required.</span>}
        </div>
      ) : (
        <div className="text-muted-foreground">
          {visit.mode === "held" ? "Review needed — Hub check-in available." : "Square visit notes unavailable."}
        </div>
      )}
    </div>
  );
}
