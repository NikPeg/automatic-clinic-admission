/**
 * Graph nodes + the field-level helpers they share. The LLM (via OpenRouter) is
 * used for two things only: pulling a value out of a free-form utterance
 * (`extractValue`) and judging confirm-vs-correction at review (`classifyReview`).
 * Everything else — format checks, normalization, name plausibility, the
 * spell-by-letter / confirm flow — is deterministic (lib/validation.ts + here).
 */
import { chat } from "../openrouter.ts";
import { FIELDS, PATIENT_TYPE, type FieldSpec, type PartialIntake } from "../schema.ts";
import {
  looksLikeName,
  normalizeDob,
  normalizeFutureDate,
  normalizePhone,
  parseDateParts,
  reconstructSpelledName,
} from "../validation.ts";
import type { ClarifyKind, IntakeStateType, Msg } from "./state.ts";

type Kind = "name" | "dob" | "phone" | "apptdate" | "enum" | "bool" | "text";

const KIND: Record<string, Kind> = {
  fullName: "name",
  dob: "dob",
  mobilePhone: "phone",
  preferredDate: "apptdate",
  hasInsurance: "bool",
  patientType: "enum",
};

/** "Monday, July 14, 2026" from MM/DD/YYYY. */
function formatDateLong(mmddyyyy: string): string {
  const p = parseDateParts(mmddyyyy);
  if (!p) return mmddyyyy;
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const ENUM_OPTIONS: Record<string, readonly string[]> = {
  patientType: PATIENT_TYPE,
};

const fieldKind = (key: string): Kind => KIND[key] ?? "text";
const getField = (key: string): FieldSpec => FIELDS.find((f) => f.key === key)!;
const firstNameOf = (full: unknown): string =>
  full ? String(full).trim().split(/\s+/)[0] : "";

/** First not-yet-addressed field. */
export function nextField(form: PartialIntake): FieldSpec | null {
  return FIELDS.find((f) => !(f.key in form) && (!f.askWhen || f.askWhen(form))) ?? null;
}

const SKIP_WORDS = new Set(["none", "no", "skip", "n/a", "na", "nope", "no thanks"]);

// ---------------------------------------------------------------------------
// Normalization for non-name fields (names get the spell/confirm flow below).
// ---------------------------------------------------------------------------

type NormResult =
  | { ok: true; value: string | boolean }
  | { ok: false; clarify: ClarifyKind };

function coerceBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["yes", "y", "true", "yeah", "yep", "i do", "sure"].includes(v)) return true;
    if (["no", "n", "false", "nope", "i don't", "i do not"].includes(v)) return false;
  }
  return null;
}

/** Three numeric groups with no letters → a digit date we should trust literally. */
const NUMERIC_DATE_RE = /\d{1,4}\s*[\/.\-\s]\s*\d{1,2}\s*[\/.\-\s]\s*\d{1,4}/;
const isNumericDate = (s: string) => !/[A-Za-z]/.test(s) && NUMERIC_DATE_RE.test(s);

/**
 * Which string to validate as a date: for a digit date, the patient's RAW input
 * (so the model can't silently "fix" an impossible date like 32/02); otherwise
 * the model's value (needed for worded/relative dates: "May 14th", "tomorrow").
 */
function pickDateSource(state: IntakeStateType): string {
  const raw = state.userInput ?? "";
  return isNumericDate(raw) ? raw : String(state.extracted?.value ?? "");
}

/** Lenient yes/no for confirmation prompts (keyword anywhere in the reply). */
function parseYesNo(text: string): boolean | null {
  const t = text.toLowerCase();
  if (/\b(yes|yeah|yep|yup|correct|right|sure|ok|okay|that's it)\b/.test(t)) return true;
  if (/\b(no|nope|wrong|incorrect|not right|nah)\b/.test(t)) return false;
  return null;
}

function normalizeField(key: string, rawValue: unknown): NormResult {
  const kind = fieldKind(key);
  const str = rawValue == null ? "" : String(rawValue).trim();
  switch (kind) {
    case "dob": {
      const n = normalizeDob(str);
      return n ? { ok: true, value: n } : { ok: false, clarify: "bad_format" };
    }
    case "phone": {
      const n = normalizePhone(str);
      return n ? { ok: true, value: n } : { ok: false, clarify: "bad_format" };
    }
    case "apptdate": {
      const n = normalizeFutureDate(str);
      return n ? { ok: true, value: n } : { ok: false, clarify: "bad_format" };
    }
    case "enum": {
      const opts = ENUM_OPTIONS[key] ?? [];
      const match = opts.find((o) => o.toLowerCase() === str.toLowerCase());
      return match ? { ok: true, value: match } : { ok: false, clarify: "enum" };
    }
    case "bool": {
      const b = coerceBool(rawValue);
      return b == null ? { ok: false, clarify: "reask" } : { ok: true, value: b };
    }
    default:
      return str ? { ok: true, value: str } : { ok: false, clarify: "reask" };
  }
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`Model did not return JSON:\n${text}`);
  }
}

function fieldDescriptor(field: FieldSpec): string {
  const kind = fieldKind(field.key);
  if (kind === "enum") return `${field.label} — must be one of: ${ENUM_OPTIONS[field.key].join(", ")}.`;
  if (kind === "bool") return `${field.label} — a yes/no answer (return true or false).`;
  if (kind === "dob") return `${field.label} — a date of birth.`;
  if (kind === "apptdate") return `${field.label} — the day the patient wants their appointment.`;
  if (kind === "phone") return `${field.label} — a US phone number.`;
  return field.label;
}

/** Pull the value for `currentField` out of the user's latest utterance. */
async function extractValue(
  field: FieldSpec,
  userInput: string,
  lastAssistant: string,
): Promise<{ provided: boolean; value: unknown; seemsRealName?: boolean; explicit?: boolean; seemsValid?: boolean }> {
  const kind = fieldKind(field.key);
  const isName = kind === "name";
  const isApptDate = kind === "apptdate";
  const isReason = field.key === "reasonForVisit";
  const today = new Date();
  const todayLong = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const system =
    "You are an intake assistant's extraction step. From the patient's reply, extract ONLY " +
    "the value for the requested field. Respond with strict JSON and nothing else.\n" +
    'Shape: {"provided": boolean, "value": <string|boolean|null>' +
    (isName ? ', "seemsRealName": boolean' : "") +
    (isApptDate ? ', "explicit": boolean' : "") +
    (isReason ? ', "seemsValid": boolean' : "") +
    "}\n" +
    "- provided=false if the patient asked a question or didn't actually answer this field. value=null then.\n" +
    "- For yes/no fields, value must be true or false.\n" +
    "- For choice fields, map to exactly one of the allowed options.\n" +
    (kind === "dob"
      ? '- For this date, return value strictly as "MM/DD/YYYY" (zero-padded, 4-digit year), ' +
        "converting spoken or worded dates and using US month/day order.\n"
      : "") +
    (isApptDate
      ? `- Today is ${todayLong}. Resolve relative expressions like "tomorrow", "next Monday", ` +
        '"in two weeks" to an absolute date. Return value strictly as "MM/DD/YYYY".\n' +
        "- explicit=true ONLY if the patient stated a concrete calendar date themselves; " +
        "explicit=false if it was relative or vague (tomorrow, next week, Friday, etc.).\n"
      : "") +
    (isName
      ? "- seemsRealName=false if the value looks like gibberish or not a real human name.\n"
      : "") +
    (isReason
      ? "- For the reason for visit: set provided=true whenever the patient says any answer text " +
        "(even nonsense). Put a SHORT, distilled reason in value — strip filler, hesitations " +
        "(\"um\", \"I guess\", \"I was thinking\") and \"I want to / I have\" framing; keep just the " +
        "key symptom or specialist, capitalized. Examples: \"um I guess I'd like to see a " +
        'therapist" → "Therapist"; "I\'ve had a really bad headache for days" → "Headache". ' +
        "Set seemsValid=false if it isn't a plausible reason to see a medical clinic " +
        "(gibberish, random characters, unrelated chit-chat).\n"
      : "");
  const user =
    `Field to extract: ${fieldDescriptor(field)}\n` +
    `Assistant just asked: "${lastAssistant}"\n` +
    `Patient replied: "${userInput}"`;
  const raw = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0 },
  );
  const obj = parseJsonObject(raw);
  return {
    provided: obj.provided === true,
    value: obj.value ?? null,
    seemsRealName: typeof obj.seemsRealName === "boolean" ? obj.seemsRealName : undefined,
    explicit: typeof obj.explicit === "boolean" ? obj.explicit : undefined,
    seemsValid: typeof obj.seemsValid === "boolean" ? obj.seemsValid : undefined,
  };
}

/** At review: is the patient confirming, or correcting a specific field? */
async function classifyReview(
  userInput: string,
): Promise<{ confirmed: boolean; fieldKey: string | null; value: string | null }> {
  const keyList = FIELDS.map((f) => `${f.key} (${f.label})`).join(", ");
  const system =
    "The patient is reviewing their intake summary. Decide if they confirm everything, or " +
    "want to change one field. Respond with strict JSON only.\n" +
    'Shape: {"confirmed": boolean, "fieldKey": <one of the keys or null>, "value": <new value or null>}\n' +
    `Valid field keys: ${keyList}`;
  const raw = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: `Patient said: "${userInput}"` },
    ],
    { temperature: 0 },
  );
  const obj = parseJsonObject(raw);
  const fieldKey =
    typeof obj.fieldKey === "string" && FIELDS.some((f) => f.key === obj.fieldKey)
      ? (obj.fieldKey as string)
      : null;
  return {
    confirmed: obj.confirmed === true,
    fieldKey,
    value: obj.value == null ? null : String(obj.value),
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const asMsg = (content: string): Msg => ({ role: "assistant", content });

function clarifyText(field: FieldSpec, kind: ClarifyKind): string {
  switch (kind) {
    case "spell_name":
      return `I want to make sure I get that right — could you spell your ${field.label.toLowerCase()} letter by letter?`;
    case "bad_format":
      return field.example
        ? `Sorry, that doesn't look like a valid ${field.label.toLowerCase()}. Could you give it as ${field.example}?`
        : `Sorry, that doesn't look right. Could you repeat your ${field.label.toLowerCase()}?`;
    case "enum":
      return `Please choose one of: ${(ENUM_OPTIONS[field.key] ?? []).join(", ")}.`;
    default:
      return `Sorry, I didn't catch that. ${field.question}`;
  }
}

function summary(form: PartialIntake): string {
  return FIELDS.filter((f) => f.key in form && form[f.key] != null)
    .map((f) => {
      const v = form[f.key];
      const shown = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
      return `  • ${f.label}: ${shown}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const GREETING =
  "Hi! I'll help you book your appointment, and I'll just ask a few quick questions.";

/** Opening turn: ask the first field. */
export function greet(state: IntakeStateType): Partial<IntakeStateType> {
  const field = nextField(state.form);
  if (!field) return { assistantMessage: "You're all set." };
  const msg = `${GREETING} ${field.question}`;
  return { currentField: field.key, assistantMessage: msg, messages: [asMsg(msg)] };
}

export async function extract(state: IntakeStateType): Promise<Partial<IntakeStateType>> {
  // The name spell/confirm and date-confirm sub-flows are handled in `validate`.
  const clar = state.clarification?.kind;
  if (clar === "spell_name" || clar === "confirm_name" || clar === "confirm_date" || clar === "confirm_reason") {
    return { extracted: null };
  }
  // The phone yes/no stage is handled deterministically; only extract once we're
  // actually collecting dictated digits.
  if (state.currentField === "mobilePhone" && clar !== "ask_phone_digits") {
    return { extracted: null };
  }

  const field = getField(state.currentField!);
  const lastAssistant =
    [...state.messages].reverse().find((m) => m.role === "assistant")?.content ?? field.question;
  const extracted = await extractValue(field, state.userInput ?? "", lastAssistant);
  return { extracted };
}

/** Handle name fields: spell-by-letter, then explicit yes/no confirmation. */
function validateName(state: IntakeStateType, field: FieldSpec): Partial<IntakeStateType> {
  const ui = state.userInput ?? "";
  const clar = state.clarification?.kind;

  if (clar === "confirm_name") {
    const yn = parseYesNo(ui);
    if (yn === true) {
      return { form: { ...state.form, [field.key]: state.pending }, clarification: null, pending: null, extracted: null };
    }
    if (yn === false) {
      const msg = `No problem. Could you spell your ${field.label.toLowerCase()} letter by letter?`;
      return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "spell_name", fieldKey: field.key }, pending: null };
    }
    const msg = `Sorry — I have "${String(state.pending).toUpperCase()}". Is that correct? Please say yes or no.`;
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_name", fieldKey: field.key } };
  }

  if (clar === "spell_name") {
    const candidate = reconstructSpelledName(ui) ?? (looksLikeName(ui.trim()) ? ui.trim() : null);
    if (candidate) {
      const msg = `The name is "${candidate.toUpperCase()}" — is that correct?`;
      return { pending: candidate, assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_name", fieldKey: field.key } };
    }
    const msg = `Sorry, I didn't catch the letters. Could you spell your ${field.label.toLowerCase()} again, letter by letter?`;
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "spell_name", fieldKey: field.key } };
  }

  // Initial attempt at the name.
  const ex = state.extracted!;
  if (!ex.provided) {
    const msg = clarifyText(field, "reask");
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
  }
  const candidate = ex.value == null ? "" : String(ex.value).trim();
  if (looksLikeName(candidate) && ex.seemsRealName !== false) {
    return { form: { ...state.form, [field.key]: candidate }, clarification: null, extracted: null };
  }
  const msg = clarifyText(field, "spell_name");
  return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "spell_name", fieldKey: field.key } };
}

/**
 * Reason for visit: the LLM judges plausibility. Invalid → re-ask once; a second
 * invalid answer → read it back to confirm ("...is that correct?"). On "no", the
 * re-ask / confirm cycle repeats.
 */
function validateReason(state: IntakeStateType, field: FieldSpec): Partial<IntakeStateType> {
  const ui = state.userInput ?? "";
  const clar = state.clarification?.kind;

  if (clar === "confirm_reason") {
    const yn = parseYesNo(ui);
    if (yn === true) {
      return { form: { ...state.form, [field.key]: state.pending }, clarification: null, pending: null, extracted: null };
    }
    if (yn === false) {
      const msg = "No problem — what brings you in today?";
      return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key }, pending: null };
    }
    const msg = `Sorry — your reason for visit is "${String(state.pending)}". Is that correct? Please say yes or no.`;
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_reason", fieldKey: field.key } };
  }

  const ex = state.extracted!;
  const value = String(ex.value ?? "").trim();
  const valid = ex.provided && value.length > 0 && ex.seemsValid !== false;
  if (valid) {
    return { form: { ...state.form, [field.key]: value }, clarification: null, extracted: null };
  }

  // Second time it's nonsense → read it back to confirm; first time → re-ask once.
  if (clar === "reask" && value.length > 0) {
    const msg = `Your reason for visit is "${value}" — is that correct?`;
    return { pending: value, assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_reason", fieldKey: field.key } };
  }
  const msg = "Sorry, I didn't quite catch that. What brings you in today — what's the reason for your visit?";
  return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
}

// The patient's caller-ID number. In production this comes from the telephony
// layer; for the PoC/demo it's configurable.
const CALLER_NUMBER = normalizePhone(process.env.CALLER_NUMBER || "(415) 555-0142") ?? "(415) 555-0142";

/**
 * Phone: first ask whether the number they're calling from is fine (yes → no need
 * to dictate digits, we use caller ID). If not — or if they just say a number — we
 * collect and validate the digits.
 */
function validatePhone(state: IntakeStateType, field: FieldSpec): Partial<IntakeStateType> {
  const ui = state.userInput ?? "";
  const clar = state.clarification?.kind;

  const askDigits = (msg: string): Partial<IntakeStateType> => ({
    assistantMessage: msg,
    messages: [asMsg(msg)],
    clarification: { kind: "ask_phone_digits", fieldKey: field.key },
  });
  const accept = (value: string): Partial<IntakeStateType> => ({
    form: { ...state.form, [field.key]: value },
    clarification: null,
    extracted: null,
  });

  // They're dictating digits (said "no" / "a different number" earlier).
  if (clar === "ask_phone_digits") {
    const n = normalizePhone(ui);
    if (n) return accept(n);
    return askDigits(
      "That doesn't look like a valid number. Please give a number like 415-555-0142, or an international number including the country code.",
    );
  }

  // Yes/no stage. A valid US number → take it straight away.
  const direct = normalizePhone(ui);
  if (direct) return accept(direct);

  const yn = parseYesNo(ui);
  if (yn === true) return accept(CALLER_NUMBER);

  // "no" / "a different number" / "use my cell" → switch to collecting a number.
  const wantsOther = /\b(different|another|other|new|change|cell|mobile|number)\b/i.test(ui);
  // A number-looking attempt that isn't a valid US number (e.g. international).
  const looksLikeNumberAttempt = (ui.match(/\d/g) ?? []).length >= 5;

  if (yn === false || wantsOther || looksLikeNumberAttempt) {
    return askDigits(
      looksLikeNumberAttempt
        ? "That doesn't look like a complete number. What's the best number to reach you? For example, 415-555-0142, or include the country code for an international number."
        : "No problem — what number should we use?",
    );
  }

  // Genuinely unclear → re-ask the yes/no once.
  const msg = "Sorry — should we use the phone you're calling from? You can say yes, or give me a different number.";
  return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_phone", fieldKey: field.key } };
}

/** Date of birth: must be a real calendar date, in the past (today excluded). */
function validateDob(state: IntakeStateType, field: FieldSpec): Partial<IntakeStateType> {
  const ex = state.extracted!;
  if (!ex.provided) {
    const msg = clarifyText(field, "reask");
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
  }
  const source = pickDateSource(state);
  const norm = normalizeDob(source);
  if (norm) {
    return { form: { ...state.form, [field.key]: norm }, clarification: null, extracted: null };
  }
  // Tailor the re-ask: a real-but-future date vs. an impossible/unparseable one.
  const parts = parseDateParts(source);
  const isFuture = parts != null && new Date(parts.y, parts.m - 1, parts.d).getTime() > Date.now();
  const msg = isFuture
    ? "That date is in the future — what's your actual date of birth?"
    : clarifyText(field, "bad_format");
  return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
}

/** Handle the appointment date: resolve relative dates, confirm if not explicit. */
function validateDate(state: IntakeStateType, field: FieldSpec): Partial<IntakeStateType> {
  const ui = state.userInput ?? "";
  const clar = state.clarification?.kind;

  if (clar === "confirm_date") {
    const yn = parseYesNo(ui);
    if (yn === true) {
      return { form: { ...state.form, [field.key]: state.pending }, clarification: null, pending: null, extracted: null };
    }
    if (yn === false) {
      const msg = "No problem. What day would you like to come in?";
      return { assistantMessage: msg, messages: [asMsg(msg)], clarification: null, pending: null };
    }
    const msg = `Sorry — you'd like ${formatDateLong(String(state.pending))}? Please say yes or no.`;
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_date", fieldKey: field.key } };
  }

  const ex = state.extracted!;
  if (!ex.provided) {
    const msg = clarifyText(field, "reask");
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
  }

  const source = pickDateSource(state);
  const future = normalizeFutureDate(source);
  if (!future) {
    // Distinguish a real-but-past date from something impossible/unparseable.
    const msg = parseDateParts(source)
      ? "That date is in the past. What upcoming day would you like to come in?"
      : "Sorry, I didn't catch a valid date. What day would you like to come in?";
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
  }

  // Explicit calendar date → accept; relative/vague → read it back to confirm.
  if (ex.explicit) {
    return { form: { ...state.form, [field.key]: future }, clarification: null, extracted: null };
  }
  const msg = `You'd like to come in on ${formatDateLong(future)} — is that right?`;
  return { pending: future, assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "confirm_date", fieldKey: field.key } };
}

export function validate(state: IntakeStateType): Partial<IntakeStateType> {
  const field = getField(state.currentField!);
  if (field.key === "reasonForVisit") return validateReason(state, field);
  if (field.key === "mobilePhone") return validatePhone(state, field);
  if (fieldKind(field.key) === "name") return validateName(state, field);
  if (fieldKind(field.key) === "dob") return validateDob(state, field);
  if (fieldKind(field.key) === "apptdate") return validateDate(state, field);

  const ex = state.extracted!;

  // Optional field the patient declined / said "none" → record null and move on.
  const valStr = ex.value == null ? "" : String(ex.value).trim().toLowerCase();
  if (!field.required && (!ex.provided || SKIP_WORDS.has(valStr))) {
    return { form: { ...state.form, [field.key]: null }, clarification: null, extracted: null };
  }

  if (!ex.provided) {
    const msg = clarifyText(field, "reask");
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: "reask", fieldKey: field.key } };
  }

  const res = normalizeField(field.key, ex.value);
  if (!res.ok) {
    const msg = clarifyText(field, res.clarify);
    return { assistantMessage: msg, messages: [asMsg(msg)], clarification: { kind: res.clarify, fieldKey: field.key } };
  }
  return { form: { ...state.form, [field.key]: res.value }, clarification: null, extracted: null };
}

// Varied acknowledgements so the assistant doesn't sound like a broken record.
const ADVANCE_PREFIX: Partial<Record<string, string>> = {
  dob: "Perfect. ",
  mobilePhone: "Got it. ",
  preferredDate: "Thanks. ",
  hasInsurance: "Perfect. ",
  insuranceCarrier: "Great. ",
  insuranceMemberId: "Got it. ",
  insuranceGroupNumber: "Thanks. ",
  patientType: "Great. ",
};

export function advance(state: IntakeStateType): Partial<IntakeStateType> {
  const field = nextField(state.form);
  if (!field) return {}; // router → review
  const first = firstNameOf(state.form.fullName);
  // Address the patient by name when we move on to the reason for the visit.
  const prefix = field.key === "reasonForVisit" && first
    ? `Thanks, ${first}! `
    : ADVANCE_PREFIX[field.key] ?? "Got it. ";
  const msg = `${prefix}${field.question}`;
  return { currentField: field.key, clarification: null, assistantMessage: msg, messages: [asMsg(msg)] };
}

export function review(state: IntakeStateType): Partial<IntakeStateType> {
  const msg =
    "Here's what I have:\n" + summary(state.form) + "\n\nIs everything correct? Say 'yes' to book, or tell me what to change.";
  return { status: "reviewing", assistantMessage: msg, messages: [asMsg(msg)] };
}

export async function reviewDecision(state: IntakeStateType): Promise<Partial<IntakeStateType>> {
  // Fast path: a plain "yes" books immediately — no model call, no wait.
  if (parseYesNo(state.userInput ?? "") === true) return { decision: "submit" };

  const decision = await classifyReview(state.userInput ?? "");
  if (decision.confirmed) return { decision: "submit" };

  if (decision.fieldKey && decision.value != null) {
    // Names go through the spell/confirm flow; other fields normalize directly.
    if (fieldKind(decision.fieldKey) !== "name") {
      const res = normalizeField(decision.fieldKey, decision.value);
      if (res.ok) return { decision: "review", form: { ...state.form, [decision.fieldKey]: res.value } };
    } else if (looksLikeName(decision.value)) {
      return { decision: "review", form: { ...state.form, [decision.fieldKey]: decision.value.trim() } };
    }
  }
  const msg = "Sorry, I didn't catch the change. Say 'yes' to confirm, or tell me which field to fix and the new value.";
  return { decision: "reask", assistantMessage: msg, messages: [asMsg(msg)] };
}

/**
 * After the booking is confirmed, the assistant has asked "anything else?".
 * Any reply here ends the conversation gracefully — no re-asking of fields.
 */
export function farewell(state: IntakeStateType): Partial<IntakeStateType> {
  const wantsMore = parseYesNo(state.userInput ?? "") === true;
  const first = firstNameOf(state.form.fullName);
  const msg = wantsMore
    ? "Your appointment is booked. For anything else, please give the clinic a call. Take care!"
    : `You're all set${first ? `, ${first}` : ""} — your appointment is confirmed. Take care, and see you soon!`;
  return { status: "done", assistantMessage: msg, messages: [asMsg(msg)] };
}

export function submit(state: IntakeStateType): Partial<IntakeStateType> {
  const code = "CLN-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const first = firstNameOf(state.form.fullName);
  const when = state.form.preferredDate ? formatDateLong(String(state.form.preferredDate)) : "the requested day";
  const msg =
    `You're booked${first ? `, ${first}` : ""}! Your confirmation number is ${code}. ` +
    `We'll see you on ${when}. Is there anything else?`;
  return { status: "confirmed", confirmation: code, assistantMessage: msg, messages: [asMsg(msg)] };
}
