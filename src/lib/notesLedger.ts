// Parser for the final Apple Notes package/balance ledger.
// Client-safe: no server imports.

export type ParsedRow = {
  raw: string;
  line_number: number;
  row_fingerprint: string;
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
  /** Dollar amount that appears before the client name (e.g. "100 (Elizabeth Banks) 931…"). */
  leading_amount: number | null;
};

// Decorative markers to strip anywhere on the line (Apple Notes bullets/checks).
// Includes common Unicode bullets/checkmarks and their mojibake forms (e.g. "%" or "◦"
// after mis-decoded UTF-8). Treated as visual only, never data.
const DECORATIVE_RE = /[\-*•●◦·✓✔☑︎☑◘◙■□▪▫◆◇○◯\u2022\u25E6\u2713\u2714\u2611\u25A0-\u25FF\u2600-\u26FF]/g;
const LEADING_JUNK_RE = /^[\s\-*•●◦·✓✔☑︎☑%\u2022\u25E6\u2713\u2714\u2611]+/;

/** Normalize raw ledger text: line endings, Unicode form, smart quotes, tabs, decorative glyphs. */
export function normalizeLedgerText(input: string): string {
  if (!input) return "";
  let s = input;
  // Strip UTF-8 BOM
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // Unicode normalize (compose accents)
  s = s.normalize("NFC");
  // Normalize line endings
  s = s.replace(/\r\n?/g, "\n");
  // Smart quotes → ASCII
  s = s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-");
  // Non-breaking / zero-width spaces
  s = s.replace(/[\u00A0\u2007\u202F]/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Tabs → spaces
  s = s.replace(/\t/g, " ");
  // Strip decorative bullet/check glyphs entirely (visual only)
  s = s.replace(DECORATIVE_RE, " ");
  // Collapse runs of spaces (preserve newlines)
  s = s.replace(/[ \f\v]+/g, " ");
  return s;
}
const PHONE_RE = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/;
const VISITS_RE = /(\d{1,2})\s*(?:V\b|visits?\b)/i;
const OWED_RE = /(?:owes?|owed|balance|bal\.?|still\s+owes?)\s*\$?\s*(\d+(?:\.\d{1,2})?)|\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:owed|owing|remaining|left)/i;
const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const CREDIT_RE = /\b(credit|overpaid|over\s*paid|refund|\+\s?\d)/i;
const PD_RE = /\bPD\b|\bpaid\s*(in\s*)?full\b/i;

function normalizeFingerprintPart(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeLedgerText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function stableHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function numberPart(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(Number(value).toFixed(2));
}

export function normalizedRowContent(row: ParsedRow): string {
  return normalizeFingerprintPart(row.raw) ?? "";
}

export function buildLedgerRowFingerprint(row: ParsedRow): string {
  const payload = {
    raw: normalizedRowContent(row),
    name: normName(row.name),
    phone: normPhone(row.phone),
    leading_amount: numberPart(row.leading_amount),
    package_price: numberPart(row.package_price),
    package_total_visits: row.package_total_visits ?? null,
    package_start_date: row.package_start_date ?? null,
    internal_notes: normalizeFingerprintPart(row.internal_notes),
  };
  return `nlr_${stableHash(JSON.stringify(payload))}`;
}

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
  const normalized = normalizeLedgerText(text);
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let line = raw.replace(LEADING_JUNK_RE, "").trim();
    if (!line) continue;
    if (isHeadingLike(line)) continue;

    const row: ParsedRow = {
      raw,
      line_number: i + 1,
      row_fingerprint: "",
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
      leading_amount: null,
    };

    // Assessment flag: leading "A " or "A:" or "A-"
    const asmt = line.match(/^A[\s:.\-]+(.+)/);
    if (asmt) {
      row.assessment = true;
      line = asmt[1].trim();
    }

    // Leading amount: a bare number before a "(Name)" or before a name word.
    // Must be followed by "(" or 2+ letters so we don't grab the first phone digits.
    const leadingAmt = line.match(/^(\d{1,4}(?:\.\d{1,2})?)\s+(?=\(|[A-Za-z]{2,})/);
    if (leadingAmt) {
      row.leading_amount = Number(leadingAmt[1]);
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

    // Name extraction: prefer first parenthesized group that looks like a name
    // (letters/space/period/hyphen/apostrophe, no $ or digits at start).
    let namePart = "";
    const parenRe = /\(([^()]+)\)/g;
    let pm: RegExpExecArray | null;
    while ((pm = parenRe.exec(line)) !== null) {
      const inner = pm[1].trim();
      if (!inner) continue;
      if (/^\$/.test(inner)) continue; // package data like "$360 8V 5/15"
      if (/\d/.test(inner)) continue; // skip anything with digits (visits, dates)
      if (/^[A-Za-z][A-Za-z .'\-]*$/.test(inner)) {
        namePart = inner;
        break;
      }
    }
    // Fallback: everything before the first "signal" token
    if (!namePart) {
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
      namePart = line.slice(0, cutoff).trim();
    }
    // Strip leading amounts/bullets/junk and trailing parens/punctuation
    namePart = namePart
      .replace(/^[\s\d$.,()\-*•●◦·✓✔☑%]+/, "")
      .replace(/[()]+/g, "")
      .replace(/[,\-–—:;]+$/, "")
      .trim();
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

    row.row_fingerprint = buildLedgerRowFingerprint(row);

    rows.push(row);
  }
  return rows;
}

export function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}
