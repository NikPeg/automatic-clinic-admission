/**
 * Phase 2 — headless, text-only REPL for the intake agent.
 * You play the patient; the agent asks questions and fills the form.
 * Type `/form` to print the current intake state, `/quit` to exit.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildGraph } from "../lib/agent/graph.ts";
import type { IntakeStateType } from "../lib/agent/state.ts";

const graph = buildGraph();

function printForm(state: Partial<IntakeStateType>) {
  console.log("\n--- intake form ---");
  console.log(JSON.stringify(state.form ?? {}, null, 2));
  console.log("-------------------\n");
}

async function main() {
  const rl = createInterface({ input, output });

  // Opening turn (no user input yet) → the agent greets and asks the first field.
  let state = (await graph.invoke({})) as IntakeStateType;
  console.log(`\nassistant: ${state.assistantMessage}\n`);

  while (state.status !== "confirmed") {
    const line = (await rl.question("you: ")).trim();
    if (line === "/quit") break;
    if (line === "/form") {
      printForm(state);
      continue;
    }
    if (!line) continue;

    state = (await graph.invoke({
      ...state,
      userInput: line,
      messages: state.messages.concat([{ role: "user", content: line }]),
    })) as IntakeStateType;

    console.log(`\nassistant: ${state.assistantMessage}\n`);
  }

  printForm(state);
  if (state.confirmation) console.log(`✅ Confirmation: ${state.confirmation}`);
  rl.close();
}

main().catch((err) => {
  console.error("\n❌ chat-cli failed:\n" + (err as Error).message);
  process.exit(1);
});
