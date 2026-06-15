/**
 * The single source of truth for the patient intake: a Zod schema (used for
 * final validation + LLM structured extraction later) and an ordered FIELDS
 * registry (the agent walks these to decide what to ask next).
 *
 * Field semantics live in docs/INTAKE_FORM.md.
 */
import { z } from "zod";
import { isValidDob, isValidFutureDate, isValidPhone, looksLikeName } from "./validation.ts";

export const PATIENT_TYPE = ["New", "Established"] as const;

const nameField = z.string().refine(looksLikeName, "doesn't look like a name");

/** The fully-completed, validated intake. */
export const IntakeSchema = z
  .object({
    fullName: nameField,
    reasonForVisit: z.string().min(1),
    dob: z.string().refine(isValidDob, "expected MM/DD/YYYY"),
    mobilePhone: z.string().refine(isValidPhone, "invalid phone number"),
    preferredDate: z.string().refine(isValidFutureDate, "must be today or a future date"),
    hasInsurance: z.boolean(),
    // Collected only when the patient has insurance (the common case in the US).
    insuranceCarrier: z.string().min(1).optional(),
    insuranceMemberId: z.string().min(1).optional(),
    insuranceGroupNumber: z.string().min(1).optional(),
    patientType: z.enum(PATIENT_TYPE),
  })
  .superRefine((data, ctx) => {
    // Insured patients must give carrier + member ID (what a US front desk needs).
    if (data.hasInsurance) {
      for (const key of ["insuranceCarrier", "insuranceMemberId"] as const) {
        if (!data[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when insured` });
        }
      }
    }
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
  /** Only ask this field when the predicate holds for the form so far. */
  askWhen?: (form: PartialIntake) => boolean;
};

const insured = (f: PartialIntake) => f.hasInsurance === true;

/** The ordered intake interview. The agent walks this top-to-bottom. */
export const FIELDS: FieldSpec[] = [
  { key: "fullName", label: "Full name", required: true, question: "What's your full name?" },
  { key: "reasonForVisit", label: "Reason for visit", required: true, question: "What brings you in today — what's the reason for your visit?" },
  { key: "dob", label: "Date of birth", required: true, example: "month, day, year — for example, May fourteenth, nineteen-ninety", question: "What's your date of birth?" },
  { key: "mobilePhone", label: "Phone", required: true, example: "a number like 415-555-0142, or an international number with the country code", question: "Is the phone you're calling from the best way to reach you?" },
  { key: "preferredDate", label: "Preferred date", required: true, question: "What day would you like to come in?" },
  { key: "hasInsurance", label: "Insurance", required: true, question: "Do you have health insurance? Most patients do — just say yes or no." },
  { key: "insuranceCarrier", label: "Insurance carrier", required: true, askWhen: insured, question: "Great. Who's your insurance carrier? For example, Aetna, Blue Cross Blue Shield, UnitedHealthcare, or Cigna." },
  { key: "insuranceMemberId", label: "Member ID", required: true, askWhen: insured, question: "What's the member or subscriber ID on your insurance card?" },
  { key: "insuranceGroupNumber", label: "Group number", required: false, askWhen: insured, question: "And the group number on the card, if there is one? You can say 'none'." },
  { key: "patientType", label: "Patient type", required: true, question: "Are you a new patient, or have you been seen here before?" },
];

/** Required fields that currently apply, given the form so far. */
export function applicableRequiredFields(form: PartialIntake): FieldSpec[] {
  return FIELDS.filter((f) => f.required && (!f.askWhen || f.askWhen(form)));
}
