/**
 * LangGraph state for the intake conversation. The graph processes ONE user
 * turn per `invoke` (entry → … → END) and the CLI / API loop feeds the next
 * user utterance back in. See docs/ARCHITECTURE.md §5.
 */
import { Annotation } from "@langchain/langgraph";
import type { PartialIntake } from "../schema.ts";

export type Role = "user" | "assistant" | "system";
export type Msg = { role: Role; content: string };

export type Status = "collecting" | "reviewing" | "confirmed";

export type ClarifyKind =
  | "spell_name"
  | "confirm_name"
  | "confirm_date"
  | "confirm_reason"
  | "confirm_phone"
  | "ask_phone_digits"
  | "bad_format"
  | "enum"
  | "reask";
export type Clarify = { kind: ClarifyKind; fieldKey: string } | null;

/** What the extractor pulled from the latest user message for `currentField`. */
export type Extracted = {
  provided: boolean;
  value: unknown;
  seemsRealName?: boolean;
  /** For appointment dates: did the patient state a concrete date (no confirm needed)? */
  explicit?: boolean;
  /** For reason-for-visit: does it look like a plausible clinic reason? */
  seemsValid?: boolean;
} | null;

const replace = <T>() => ({
  reducer: (_prev: T, next: T) => next,
});

export const IntakeState = Annotation.Root({
  /** Full conversation history (assistant + user lines). */
  messages: Annotation<Msg[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  /** Confirmed field values (value may be null for a skipped optional field). */
  form: Annotation<PartialIntake>({ ...replace<PartialIntake>(), default: () => ({}) }),
  /** The field currently being collected. */
  currentField: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  status: Annotation<Status>({ ...replace<Status>(), default: () => "collecting" }),
  /** The latest user utterance for this turn (null on the opening greeting). */
  userInput: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  /** The assistant's reply produced this turn (what the CLI prints / TTS speaks). */
  assistantMessage: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  clarification: Annotation<Clarify>({ ...replace<Clarify>(), default: () => null }),
  /** A reconstructed name awaiting yes/no confirmation (spell-by-letter flow). */
  pending: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  confirmation: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
  // Transient working channels (set and consumed within a single turn).
  extracted: Annotation<Extracted>({ ...replace<Extracted>(), default: () => null }),
  /** Review-step routing signal: "submit" | "review" | "reask". */
  decision: Annotation<string | null>({ ...replace<string | null>(), default: () => null }),
});

export type IntakeStateType = typeof IntakeState.State;
