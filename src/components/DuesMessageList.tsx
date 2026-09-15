import { formatCurrency, formatDate } from "@/lib/clients";
import { statusLabel, type DuesMessage } from "@/lib/dues-messaging";

export function DuesStatusPill({ m }: { m: Pick<DuesMessage, "status"> }) {
  const cls =
    m.status === "ready_not_sent"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : m.status === "failed"
        ? "bg-red-100 text-red-800 border-red-200"
        : m.status === "payment_received"
          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
          : "bg-blue-100 text-blue-800 border-blue-200";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {statusLabel(m)}
    </span>
  );
}

export function DuesMessageList({ messages }: { messages: DuesMessage[] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-slate-500">No dues messages yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {m.message_type === "renewal_due" ? "Renewal due" : "Balance due"}
              </span>
              <DuesStatusPill m={m} />
              {m.direction === "inbound" && (
                <span className="text-xs text-slate-500">from client</span>
              )}
            </div>
            <span className="text-xs text-slate-400">
              {new Date(m.created_at).toLocaleString()}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Amount: {formatCurrency(m.amount_due)}</span>
            {m.package_start_date && <span>Starts {formatDate(m.package_start_date)}</span>}
            <span>Trigger: {m.trigger_source.replace(/_/g, " ")}</span>
            {m.twilio_sid && <span>ID: {m.twilio_sid}</span>}
          </div>
          {m.blocked && (m.validation_warnings?.length ?? 0) > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-600">
              {(m.validation_warnings ?? []).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SendingDisabledBanner({ enabled }: { enabled: boolean }) {
  if (enabled) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      SMS Sending Disabled — drafts only. No text has been sent to any client.
    </div>
  );
}
