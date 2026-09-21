import { describe, expect, it } from "vitest";
import { buildDuesTextsBoard, type BoardCard } from "@/lib/dues-texts-board";

const NOW = new Date("2026-09-21T12:00:00Z").getTime();

function card(over: Partial<BoardCard> & { id: string }): BoardCard {
  return {
    clientId: "c1",
    clientName: "Test Client",
    messageType: "balance_due",
    status: "ready_not_sent",
    body: "body",
    amountDue: 0,
    blocked: false,
    warnings: [],
    eligibility: "consented",
    packageName: null,
    visitsUsed: null,
    visitsTotal: null,
    renewalStartDate: null,
    twilioSid: null,
    errorMessage: null,
    sentAt: null,
    createdAt: "2026-09-21T10:00:00Z",
    ...over,
  };
}

describe("buildDuesTextsBoard", () => {
  it("counts a consent confirmation as ready but adds $0 to the ready total", () => {
    const board = buildDuesTextsBoard(
      [
        card({ id: "m1", messageType: "consent_confirmation", clientId: "a", amountDue: 0 }),
        card({ id: "m2", messageType: "balance_due", clientId: "b", amountDue: 375 }),
      ],
      NOW,
    );
    expect(board.counts.ready).toBe(2);
    expect(board.readyTotal).toBe(375);
  });

  it("excludes sends older than 7 days from Sent / Delivered", () => {
    const board = buildDuesTextsBoard(
      [
        card({ id: "old", status: "delivered", sentAt: "2026-09-01T10:00:00Z" }),
        card({ id: "new", status: "delivered", sentAt: "2026-09-20T10:00:00Z" }),
      ],
      NOW,
    );
    expect(board.sent.map((c) => c.id)).toEqual(["new"]);
  });

  it("gates a dues text behind that client's unsent confirmation", () => {
    const board = buildDuesTextsBoard(
      [
        card({ id: "conf", messageType: "consent_confirmation", body: "opt-in" }),
        card({ id: "dues", messageType: "balance_due", amountDue: 50 }),
      ],
      NOW,
    );
    const dues = board.ready.find((c) => c.id === "dues")!;
    expect(dues.requiresConfirmationFirst).toBe(true);
    expect(dues.confirmationId).toBe("conf");
    expect(dues.confirmationBody).toBe("opt-in");
    // The confirmation itself is never gated.
    expect(board.ready.find((c) => c.id === "conf")!.requiresConfirmationFirst).toBe(false);
  });

  it("does not gate when the client's confirmation already sent", () => {
    const board = buildDuesTextsBoard(
      [
        card({ id: "conf", messageType: "consent_confirmation", status: "delivered", sentAt: "2026-09-20T10:00:00Z" }),
        card({ id: "dues", messageType: "balance_due", amountDue: 50 }),
      ],
      NOW,
    );
    expect(board.ready.find((c) => c.id === "dues")!.requiresConfirmationFirst).toBe(false);
  });

  it("separates blocked drafts and payment-received closures", () => {
    const board = buildDuesTextsBoard(
      [
        card({ id: "b1", blocked: true, warnings: ["SMS consent not recorded"] }),
        card({ id: "p1", status: "payment_received" }),
      ],
      NOW,
    );
    expect(board.counts.ready).toBe(0);
    expect(board.blocked.map((c) => c.id)).toEqual(["b1"]);
    expect(board.closed.map((c) => c.id)).toEqual(["p1"]);
    expect(board.counts.closed).toBe(1);
  });
});
