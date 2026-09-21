/**
 * Pure grouping logic for the Dues Texts operational board.
 *
 * The caller recomputes each card from live client state (never from the
 * stored draft row) and hands the cards here; this module only decides which
 * section a card belongs in, which dues cards must wait behind an unsent
 * opt-in confirmation, and what the tile counts.
 */
import type { SmsEligibility } from "@/lib/dues-messaging";

export const SENT_WINDOW_DAYS = 7;

export interface BoardCard {
  id: string;
  clientId: string;
  clientName: string;
  messageType: string;
  status: string;
  body: string;
  amountDue: number;
  blocked: boolean;
  warnings: string[];
  eligibility: SmsEligibility;
  packageName: string | null;
  visitsUsed: number | null;
  visitsTotal: number | null;
  renewalStartDate: string | null;
  twilioSid: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ReadyCard extends BoardCard {
  /** A dues text may not go out before this client's opt-in confirmation. */
  requiresConfirmationFirst: boolean;
  confirmationId: string | null;
  confirmationBody: string | null;
}

export interface DuesTextsBoard {
  ready: ReadyCard[];
  blocked: BoardCard[];
  sent: BoardCard[];
  closed: BoardCard[];
  counts: { ready: number; blocked: number; closed: number };
  /** Money represented by ready dues texts. Confirmations carry no amount. */
  readyTotal: number;
}

function isMoneyMessage(type: string): boolean {
  return type === "balance_due" || type === "renewal_due";
}

const SENT_STATUSES = new Set(["sent", "delivered", "failed", "replied"]);

function withinWindow(card: BoardCard, now: number): boolean {
  const stamp = card.sentAt ?? card.createdAt;
  const t = new Date(stamp).getTime();
  if (Number.isNaN(t)) return false;
  return now - t <= SENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function newestFirst(a: BoardCard, b: BoardCard): number {
  return (
    new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime()
  );
}

export function buildDuesTextsBoard(
  cards: BoardCard[],
  now: number = Date.now(),
): DuesTextsBoard {
  const drafts = cards.filter((c) => c.status === "ready_not_sent");
  const readyRaw = drafts.filter((c) => !c.blocked);
  const blocked = drafts.filter((c) => c.blocked).sort(newestFirst);
  const sent = cards
    .filter((c) => SENT_STATUSES.has(c.status) && withinWindow(c, now))
    .sort(newestFirst);
  const closed = cards.filter((c) => c.status === "payment_received").sort(newestFirst);

  // An unsent confirmation — ready or blocked — still gates that client's dues
  // texts: the confirmation must be the first message they ever receive.
  const pendingConfirmation = new Map<string, BoardCard>();
  for (const c of drafts) {
    if (c.messageType === "consent_confirmation") pendingConfirmation.set(c.clientId, c);
  }

  const ready: ReadyCard[] = readyRaw
    .map((c) => {
      const gate =
        c.messageType === "consent_confirmation"
          ? null
          : (pendingConfirmation.get(c.clientId) ?? null);
      return {
        ...c,
        requiresConfirmationFirst: !!gate,
        confirmationId: gate?.id ?? null,
        confirmationBody: gate?.body ?? null,
      };
    })
    .sort((a, b) => {
      // Confirmations first — they unlock everything else for that client.
      const rank = (x: ReadyCard) => (x.messageType === "consent_confirmation" ? 0 : 1);
      return rank(a) - rank(b) || newestFirst(a, b);
    });

  const readyTotal = ready.reduce(
    (sum, c) => sum + (isMoneyMessage(c.messageType) ? Number(c.amountDue || 0) : 0),
    0,
  );

  return {
    ready,
    blocked,
    sent,
    closed,
    counts: { ready: ready.length, blocked: blocked.length, closed: closed.length },
    readyTotal,
  };
}
