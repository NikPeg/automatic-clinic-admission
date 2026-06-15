/**
 * Phase 2 — non-interactive driver for automated checks. Reads the patient's
 * turns from stdin (one per line), runs them through the same graph as the REPL,
 * and prints the transcript + final form. Used to verify the checkpoint cases.
 *
 *   printf '%s\n' "Jane" "Doe" ... | npm run sim
 */
import "dotenv/config";
import { buildGraph } from "../lib/agent/graph.ts";
import type { IntakeStateType } from "../lib/agent/state.ts";

async function readStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function main() {
  const turns = await readStdin();
  const graph = buildGraph();

  let state = (await graph.invoke({})) as IntakeStateType;
  console.log(`assistant: ${state.assistantMessage}`);

  for (const line of turns) {
    if (state.status === "confirmed") break;
    console.log(`you: ${line}`);
    state = (await graph.invoke({
      ...state,
      userInput: line,
      messages: state.messages.concat([{ role: "user", content: line }]),
    })) as IntakeStateType;
    console.log(`assistant: ${state.assistantMessage}`);
  }

  console.log("\n--- final form ---");
  console.log(JSON.stringify(state.form, null, 2));
  if (state.confirmation) console.log(`\n✅ Confirmation: ${state.confirmation}`);
  console.log(`status: ${state.status}`);
}

main().catch((err) => {
  console.error("\n❌ sim failed:\n" + (err as Error).message);
  process.exit(1);
});
