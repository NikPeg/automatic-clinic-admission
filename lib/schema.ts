/**
 * The single source of truth for the patient intake: a Zod schema (used for
 * final validation + LLM structured extraction later) and an ordered FIELDS
 * registry (the agent walks these to decide what to ask next).
 *
 * Scope: a focused 7-question booking flow. Field semantics live in
 * docs/INTAKE_FORM.md.
 */
import { z } from "zod";
import { isValidDob, isValidFutureDate, isValidPhone, looksLikeName } from "./validation.ts";

export const PATIENT_TYPE = ["New", "Established"] as const;

const nameField = z.string().refine(looksLikeName, "doesn't look like a name");

/** The fully-completed, validated intake (the 7 essentials for booking). */
export const IntakeSchema = z.object({
  fullName: nameField,
  reasonForVisit: z.string().min(1),
  dob: z.string().refine(isValidDob, "expected MM/DD/YYYY"),
  mobilePhone: z.string().refine(isValidPhone, "invalid US phone"),
  preferredDate: z.string().refine(isValidFutureDate, "must be today or a future date"),
  hasInsurance: z.boolean(),
  patientType: z.enum(PATIENT_TYPE),
});

export type Intake = z.infer<typeof IntakeSchema>;
/** In-progress form: every field optional/nullable until confirmed. */
export type PartialIntake = Partial<Record<keyof Intake, unknown>>;

export type FieldSpec = {
  key: keyof Intake;
  label: string;
  /** Counts toward the progress bar / blocks submission. */
  required: boolean;
  /** A spoken example of the expected format, used in clarifications. */
  example?: string;
  /** The assistant's question when collecting this field. */
  question: string;
};

/** The ordered intake interview. The agent walks this top-to-bottom. */
export const FIELDS: FieldSpec[] = [
  { key: "fullName", label: "Full name", required: true, question: "What's your full name?" },
  { key: "reasonForVisit", label: "Reason for visit", required: true, question: "What brings you in today — what's the reason for your visit?" },
  { key: "dob", label: "Date of birth", required: true, example: "month, day, year — for example, May fourteenth, nineteen-ninety", question: "What's your date of birth?" },
  { key: "mobilePhone", label: "Mobile phone", required: true, example: "a 10-digit US number like 415-555-0142", question: "Is the phone you're calling from the best way to reach you?" },
  { key: "preferredDate", label: "Preferred date", required: true, question: "What day would you like to come in?" },
  { key: "hasInsurance", label: "Insurance", required: true, question: "Do you have health insurance?" },
  { key: "patientType", label: "Patient type", required: true, question: "Are you a new patient, or have you been seen here before?" },
];

/** Required fields that currently apply, given the form so far. */
export function applicableRequiredFields(_form: PartialIntake): FieldSpec[] {
  return FIELDS.filter((f) => f.required);
}
