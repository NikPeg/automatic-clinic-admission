/** Phase 0 — prove the LLM endpoint works. */
import "dotenv/config";
import { chat, config } from "../lib/openrouter.ts";

async function main() {
  console.log(`→ LLM model: ${config.llmModel()}`);
  const reply = await chat([
    { role: "system", content: "You are a terse health-clinic intake assistant." },
    {
      role: "user",
      content:
        "Reply in one short sentence to confirm you're working, then ask for my full legal name.",
    },
  ]);
  console.log("\n✅ LLM reply:\n" + reply + "\n");
}

main().catch((err) => {
  console.error("\n❌ LLM ping failed:\n" + (err as Error).message);
  process.exit(1);
});
