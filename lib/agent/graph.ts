/**
 * The intake graph. One `invoke` advances the conversation by a single user
 * turn: an entry router picks the path (opening greeting, normal collection, or
 * review handling), and each branch ends by producing the assistant's reply.
 * See docs/ARCHITECTURE.md §5 for the diagram.
 */
import { START, END, StateGraph } from "@langchain/langgraph";
import { IntakeState, type IntakeStateType } from "./state.ts";
import { nextField, greet, extract, validate, advance, review, reviewDecision, submit, farewell } from "./nodes.ts";

function entryRouter(state: IntakeStateType): "greet" | "extract" | "reviewDecision" | "farewell" {
  // Booking already done → any reply just closes the conversation.
  if (state.status === "confirmed" || state.status === "done") return "farewell";
  if (state.status === "reviewing") return "reviewDecision";
  if (state.userInput == null || state.currentField == null) return "greet";
  return "extract";
}

// A clarification set this turn means we re-asked and the turn ends.
const validateRouter = (s: IntakeStateType) => (s.clarification ? "end" : "advance");

// If nothing is left to ask, move to the read-back; otherwise the turn ended.
const advanceRouter = (s: IntakeStateType) => (nextField(s.form) ? "end" : "review");

const reviewRouter = (s: IntakeStateType) =>
  s.decision === "submit" ? "submit" : s.decision === "review" ? "review" : "end";

export function buildGraph() {
  return new StateGraph(IntakeState)
    .addNode("greet", greet)
    .addNode("extract", extract)
    .addNode("validate", validate)
    .addNode("advance", advance)
    .addNode("review", review)
    .addNode("reviewDecision", reviewDecision)
    .addNode("submit", submit)
    .addNode("farewell", farewell)
    .addConditionalEdges(START, entryRouter, {
      greet: "greet",
      extract: "extract",
      reviewDecision: "reviewDecision",
      farewell: "farewell",
    })
    .addEdge("farewell", END)
    .addEdge("greet", END)
    .addEdge("extract", "validate")
    .addConditionalEdges("validate", validateRouter, { advance: "advance", end: END })
    .addConditionalEdges("advance", advanceRouter, { review: "review", end: END })
    .addEdge("review", END)
    .addConditionalEdges("reviewDecision", reviewRouter, { submit: "submit", review: "review", end: END })
    .addEdge("submit", END)
    .compile();
}

export type IntakeGraph = ReturnType<typeof buildGraph>;
