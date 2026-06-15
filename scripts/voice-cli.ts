/**
 * Phase 3 — live voice loop. Push-to-talk with your microphone:
 * press Enter to start talking, Enter again to stop. We transcribe (STT), run
 * the agent, and speak the reply (TTS) out loud. Requires ffmpeg + a mic, and
 * macOS mic permission for your terminal.
 *
 *   npm run voice
 *   MIC_INDEX=1 npm run voice     # if the default mic device isn't index 0
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildGraph } from "../lib/agent/graph.ts";
import type { IntakeStateType } from "../lib/agent/state.ts";
import { transcribeBytes, pcmToWav } from "../lib/openrouter.ts";
import { speakCached } from "../lib/tts-cache.ts";
import { playWav, Recorder, detectMicIndex } from "../lib/audio.ts";

async function say(text: string): Promise<void> {
  console.log(`\n🔊 assistant: ${text}\n`);
  // Cached so the fixed questions don't re-pay TTS latency each run.
  await playWav(pcmToWav(await speakCached(text)));
}

async function main() {
  const mic = await detectMicIndex();
  console.log("Audio inputs:");
  for (const d of mic.all) console.log(`  [${d.index}] ${d.name}${d.index === mic.index ? "  ← using" : ""}`);
  console.log(`Using mic index ${mic.index} (${mic.name}). Override with MIC_INDEX=<n>.\n`);

  const rl = createInterface({ input, output });
  const graph = buildGraph();

  let state = (await graph.invoke({})) as IntakeStateType;
  await say(state.assistantMessage!);

  const maxSeconds = Number(process.env.REC_MAX_SECONDS || 60);
  while (state.status !== "confirmed") {
    await rl.question("⏺  Press Enter to start talking…");
    const rec = new Recorder(mic.index, maxSeconds);
    await rec.start();
    await rl.question(`🎙️  Recording (auto-stops after ${maxSeconds}s)… press Enter to stop.`);
    const wav = await rec.stop();

    const heard = (await transcribeBytes(wav, "wav")).trim().replace(/[.?!]+$/, "");
    console.log(`🗣️  you: ${heard}`);
    if (!heard) {
      console.log("(didn't catch anything — try again)");
      continue;
    }

    state = (await graph.invoke({
      ...state,
      userInput: heard,
      messages: state.messages.concat([{ role: "user", content: heard }]),
    })) as IntakeStateType;
    await say(state.assistantMessage!);
  }

  console.log("\n--- final form ---");
  console.log(JSON.stringify(state.form, null, 2));
  if (state.confirmation) console.log(`\n✅ Confirmation: ${state.confirmation}`);
  rl.close();
}

main().catch((err) => {
  console.error("\n❌ voice-cli failed:\n" + (err as Error).message);
  console.error("\nIf it's a device error, run the list command above and set MIC_INDEX.");
  process.exit(1);
});
