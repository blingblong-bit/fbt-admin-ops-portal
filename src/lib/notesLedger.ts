// Parser for the final Apple Notes package/balance ledger.
// Client-safe: no server imports.

export type ParsedRow = {
  raw: string;
  line_number: number;
  ok: boolean; // true if parsed enough to be considered a client row (not a heading)
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null; // normalized last-10 digits
  phone_raw: string | null;
  package_price: number | null;
  package_total_visits: number | null;
  package_start_date: string | null; // YYYY-MM-DD
  amount_owed: number | null;
  amount_paid: number | null;
  paid_in_full: boolean;
  assessment: boolean;
  internal_notes: string | null;
  needs_review: boolean;
  review_reason: string | null;
};

const BULLET_RE = /^[\s\-*•●◦·✓✔☑︎☑\u2022\u25E6\u2713\u2714\u2611]+/;
const PHONE_RE = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/;
const VISITS_RE = /(\d{1,2})\s*(?:V\b|visits?\b)/i;
const OWED_RE = /(?:owes?|owed|balance|bal\.?|still\s+owes?)\s*\$?\s*(\d+(?:\.\d{1,2})?)|\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:owed|owing|remaining|left)/i;
const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const CREDIT_RE = /\b(credit|overpaid|over\s*paid|refund|\+\s?\d)/i;
const PD_RE = /\bPD\b|\bpaid\s*(in\s*)?full\b/i;

function normPhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.replace(/\D+/g, "");
  if (!d) return null;
  return d.length > 10 ? d.slice(-10) : d.length === 10 ? d : null;
}

function toNumber(s: string): number {
  return Number(s.replace(/,/g, ""));
}

function importedDate(month: number, day: number, yearRaw?: string | undefined): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year: number;
  if (yearRaw) {
    const y = Number(yearRaw);
    year = y < 100 ? 2000 + y : y;
  } else {
    year = month >= 11 ? 2025 : 2026;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isHeadingLike(line: string): boolean {
  if (!line) return true;
  // No numbers, no dollar sign, no phone → likely a heading / therapist name
  if (!/\d/.test(line) && !/\$/.test(line)) return true;
  return false;
}

export function parseLedger(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let line = raw.replace(BULLET_RE, "").trim();
    if (!line) continue;
    if (isHeadingLike(line)) continue;

    const row: ParsedRow = {
      raw,
      line_number: i + 1,
      ok: true,
      name: null,
      first_name: null,
      last_name: null,
      phone: null,
      phone_raw: null,
      package_price: null,
      package_total_visits: null,
      package_start_date: null,
      amount_owed: null,
      amount_paid: null,
      paid_in_full: false,
      assessment: false,
      internal_notes: null,
      needs_review: false,
      review_reason: null,
    };

    // Assessment flag: leading "A " or "A:" or "A-"
    const asmt = line.match(/^A[\s:.\-]+(.+)/);
    if (asmt) {
      row.assessment = true;
      line = asmt[1].trim();
    }

    // Extract phone
    const phoneMatch = line.match(PHONE_RE);
    if (phoneMatch) {
      row.phone_raw = phoneMatch[1];
      row.phone = normPhone(phoneMatch[1]);
    }

    // Extract price
    const priceMatch = line.match(PRICE_RE);
    if (priceMatch) {
      const cents = priceMatch[2] ? Number(priceMatch[2]) / 100 : 0;
      row.package_price = toNumber(priceMatch[1]) + cents;
    }

    // Extract visits
    const visitsMatch = line.match(VISITS_RE);
    if (visitsMatch) row.package_total_visits = Number(visitsMatch[1]);

    // Extract date (avoid grabbing "8V" style — DATE_RE requires slash)
    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      row.package_start_date = importedDate(
        Number(dateMatch[1]),
        Number(dateMatch[2]),
        dateMatch[3],
      );
    }

    // PD / paid in full
    if (PD_RE.test(line)) row.paid_in_full = true;

    // Owed
    const owedMatch = line.match(OWED_RE);
    if (owedMatch) {
      const v = owedMatch[1] ?? owedMatch[2];
      if (v) row.amount_owed = Number(v);
    }

    // Compute amount_paid
    if (row.package_price !== null) {
      if (row.amount_owed !== null) {
        row.amount_paid = Math.max(0, row.package_price - row.amount_owed);
      } else if (row.paid_in_full) {
        row.amount_paid = row.package_price;
        row.amount_owed = 0;
      }
    }

    // Name extraction: everything before the first "signal" token
    const signals: number[] = [];
    if (phoneMatch) signals.push(line.indexOf(phoneMatch[0]));
    if (priceMatch) signals.push(line.indexOf(priceMatch[0]));
    if (visitsMatch) signals.push(line.indexOf(visitsMatch[0]));
    if (dateMatch) signals.push(line.indexOf(dateMatch[0]));
    const pdIdx = line.search(PD_RE);
    if (pdIdx >= 0) signals.push(pdIdx);
    const owedIdx = line.search(/owe/i);
    if (owedIdx >= 0) signals.push(owedIdx);
    const positive = signals.filter((n) => n > 0);
    const cutoff = positive.length ? Math.min(...positive) : line.length;
    let namePart = line.slice(0, cutoff).trim();
    // Trim trailing punctuation
    namePart = namePart.replace(/[,\-–—:;]+$/, "").trim();
    if (namePart) {
      row.name = namePart;
      const parts = namePart.split(/\s+/);
      row.first_name = parts[0] ?? null;
      row.last_name = parts.slice(1).join(" ") || null;
    }

    // Internal notes: trailing text after phone number (if phone found)
    if (phoneMatch) {
      const afterPhone = line.slice(line.indexOf(phoneMatch[0]) + phoneMatch[0].length).trim();
      // Strip out price/visits/date/PD/owed tokens from notes
      let notes = afterPhone
        .replace(PRICE_RE, "")
        .replace(VISITS_RE, "")
        .replace(DATE_RE, "")
        .replace(PD_RE, "")
        .replace(OWED_RE, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[,\s\-–—:;]+|[,\s\-–—:;]+$/g, "")
        .trim();
      if (notes.length > 2) row.internal_notes = notes;
    }

    // Review triggers
    const reasons: string[] = [];
    if (CREDIT_RE.test(line)) reasons.push("Credit / special balance — manual review required.");
    if (/[&]|\band\b/i.test(row.name ?? "") && /[A-Z][a-z]+\s+(&|and)\s+[A-Z][a-z]+/.test(row.name ?? "")) {
      reasons.push("Multiple names on one line — split before importing.");
    }
    if (!row.phone) reasons.push("No phone number found.");
    if (row.package_price === null) reasons.push("No package price found.");
    if (row.package_total_visits === null) reasons.push("No visit count found.");
    if (!row.name) reasons.push("No client name found.");

    if (reasons.length > 0) {
      row.needs_review = true;
      row.review_reason = reasons.join(" ");
    }

    rows.push(row);
  }
  return rows;
}

export function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}
