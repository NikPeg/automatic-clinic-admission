/**
 * Deterministic, model-free validators and US-format normalizers for intake
 * fields. These run before (and independently of) any LLM judgment.
 *
 * Convention: `normalizeX` returns the canonical string, or `null` if the input
 * can't be coerced into a valid value. `isX` returns a boolean.
 */

/**
 * Normalize a phone number. US 10-digit (or 11 with a leading 1) → "(XXX) XXX-XXXX".
 * Otherwise treated as international E.164 (8–15 digits) → "+<digits>". Null if neither.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const us = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (digits.length === 10) return us(digits);
  if (digits.length === 11 && digits.startsWith("1")) return us(digits.slice(1));
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

type DateParts = { y: number; m: number; d: number };

function calendarValid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Parse the many shapes an LLM (or person) might produce into calendar parts:
 * US digits with /, -, ., or spaces; ISO YYYY-MM-DD; "May 14, 1990"; "14 May
 * 1990". Returns null if it isn't a real calendar date. No range check here.
 */
export function parseDateParts(input: string): DateParts | null {
  // Drop trailing sentence punctuation (STT often appends "." / "?") and ordinals.
  const s = input
    .trim()
    .replace(/[.,!?;]+$/, "")
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    .trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo && calendarValid(+m[3], mo, +m[2])) return { y: +m[3], m: mo, d: +m[2] };
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/))) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo && calendarValid(+m[3], mo, +m[1])) return { y: +m[3], m: mo, d: +m[1] };
  }
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) {
    if (calendarValid(+m[1], +m[2], +m[3])) return { y: +m[1], m: +m[2], d: +m[3] };
  }
  if ((m = s.match(/^(\d{1,2})[-\/.\s]+(\d{1,2})[-\/.\s]+(\d{4})$/))) {
    if (calendarValid(+m[3], +m[1], +m[2])) return { y: +m[3], m: +m[1], d: +m[2] };
  }
  return null;
}

const fmt = (p: DateParts) =>
  `${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}/${p.y}`;

const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
};

/** Canonical "MM/DD/YYYY" for a date of birth: real, 1900+, and not in the future. */
export function normalizeDob(input: string): string | null {
  const p = parseDateParts(input);
  if (!p) return null;
  if (p.y < 1900 || p.y > new Date().getFullYear()) return null;
  if (new Date(p.y, p.m - 1, p.d).getTime() > Date.now()) return null;
  return fmt(p);
}

/** Canonical "MM/DD/YYYY" for an appointment date: real, and today or later. */
export function normalizeFutureDate(input: string): string | null {
  const p = parseDateParts(input);
  if (!p) return null;
  if (new Date(p.y, p.m - 1, p.d).getTime() < startOfToday()) return null;
  return fmt(p);
}

export function isValidFutureDate(input: string): boolean {
  return normalizeFutureDate(input) !== null;
}

export function isValidDob(input: string): boolean {
  return normalizeDob(input) !== null;
}

/**
 * Deterministic name plausibility: letters (any script), spaces, hyphen,
 * apostrophe, and period only — and at least two letters. This rejects numbers
 * and symbol soup. Whether a letters-only string is a *real* name (vs. "asdfgh")
 * is a judgment left to the LLM in the agent's validate step.
 */
export function looksLikeName(input: string): boolean {
  const trimmed = input.trim();
  if (!/^[\p{L}][\p{L}\s'’.\-]*$/u.test(trimmed)) return false;
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2;
}

/**
 * Reconstruct a name from a spelled-out answer ("J-A-N-E", "j a n e",
 * "J. A. N. E", or "double-u" style left as-is). Returns a Capitalized word, or
 * null if it doesn't look like a sequence of single letters.
 */
export function reconstructSpelledName(input: string): string | null {
  const tokens = input.trim().split(/[\s.\-,_]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const singles = tokens.filter((t) => /^\p{L}$/u.test(t));
  // Require that most tokens are single letters to treat this as "spelling".
  if (singles.length < Math.ceil(tokens.length * 0.6)) return null;
  const word = singles.join("");
  if (word.length < 2) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
