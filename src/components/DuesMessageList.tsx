import { formatCurrency, formatDate } from "@/lib/clients";
import {
  messageShowsAmount,
  messageTypeLabel,
  smsEligibilityLabel,
  statusLabel,
  type DuesMessage,
  type SmsEligibility,
} from "@/lib/dues-messaging";
import { Button } from "@/components/ui/button";

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

export function SmsEligibilityPill({ eligibility }: { eligibility: SmsEligibility }) {
  const cls =
    eligibility === "consented"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : eligibility === "opted_out"
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-amber-100 text-amber-900 border-amber-200";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {smsEligibilityLabel(eligibility)}
    </span>
  );
}

/** Conversation view: outbound on the right, client replies on the left. */
export function DuesMessageList({
  messages,
  onSend,
  sendingEnabled = false,
  sendingId = null,
}: {
  messages: DuesMessage[];
  onSend?: (m: DuesMessage) => void;
  sendingEnabled?: boolean;
  sendingId?: string | null;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-slate-500">No messages yet.</p>;
  }
  const ordered = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return (
    <ul className="space-y-3">
      {ordered.map((m) => {
        const inbound = m.direction === "inbound";
        return (
          <li key={m.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[85%] rounded-lg border p-3 ${
                inbound ? "bg-white" : "bg-slate-50"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {inbound ? "Client reply" : messageTypeLabel(m.message_type)}
                </span>
                {!inbound && <DuesStatusPill m={m} />}
                <span className="text-xs text-slate-400">
                  {new Date(m.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {!inbound && messageShowsAmount(m.message_type) && (
                  <span>Amount: {formatCurrency(m.amount_due)}</span>
                )}
                {m.package_start_date && <span>Starts {formatDate(m.package_start_date)}</span>}
                {!inbound && <span>Trigger: {m.trigger_source.replace(/_/g, " ")}</span>}
                {m.twilio_sid && <span>ID: {m.twilio_sid}</span>}
                {m.error_message && (
                  <span className="text-red-600">Failure: {m.error_message}</span>
                )}
              </div>
              {m.blocked && (m.validation_warnings?.length ?? 0) > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-red-600">
                  {(m.validation_warnings ?? []).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {onSend && !inbound && m.status === "ready_not_sent" && (
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={!sendingEnabled || m.blocked || sendingId === m.id}
                  onClick={() => onSend(m)}
                >
                  {sendingId === m.id ? "Sending…" : "Send Now"}
                </Button>
              )}
            </div>
          </li>
        );
      })}
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
