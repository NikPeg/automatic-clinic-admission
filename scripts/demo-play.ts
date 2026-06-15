/**
 * Play the pre-recorded landing-page demo from `demo/`: plays each clip in order,
 * prints the caption, and shows the intake form filling in — exactly what the
 * website's "Play demo" button will do, but in the terminal. No model, no TTS.
 *
 *   npm run demo:play           (run `npm run demo:record` once first)
 *   npm run demo:play -- --no-play   (captions + form only, no audio)
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { playWav } from "../lib/audio.ts";

const OUT = "public/demo";
const PLAY = !process.argv.includes("--no-play");

type Step = { speaker: "assistant" | "patient"; text: string; audio: string; form: Record<string, unknown> };

function printForm(form: Record<string, unknown>) {
  const keys = Object.keys(form);
  if (keys.length === 0) return;
  console.log("   ┌─ intake so far ─");
  for (const [k, v] of Object.entries(form)) {
    if (v != null) console.log(`   │ ${k}: ${typeof v === "boolean" ? (v ? "Yes" : "No") : v}`);
  }
  console.log("   └─────────────────");
}

async function main() {
  const manifest = JSON.parse(await readFile(join(OUT, "manifest.json"), "utf8")) as {
    confirmation?: string;
    steps: Step[];
  };

  for (const step of manifest.steps) {
    const who = step.speaker === "assistant" ? "🔊 assistant" : "🗣️  patient";
    console.log(`\n${who}: ${step.text}`);
    printForm(step.form);
    if (PLAY) await playWav(await readFile(join(OUT, step.audio)));
  }
  if (manifest.confirmation) console.log(`\n✅ Confirmation: ${manifest.confirmation}`);
}

main().catch((err) => {
  console.error("\n❌ demo-play failed: " + (err as Error).message);
  console.error("Did you run `npm run demo:record` first?");
  process.exit(1);
});
