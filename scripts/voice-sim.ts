/**
 * Phase 3 — automated, repeatable VOICE round-trip (no mic needed).
 *
 * For each turn it synthesizes the patient's line as speech (TTS, patient voice),
 * transcribes it back (STT), feeds the transcript to the SAME LangGraph agent,
 * then synthesizes and plays the assistant's spoken reply (TTS, assistant voice).
 * This exercises the full STT → agent → TTS chain end to end.
 *
 *   printf '%s\n' "Nik Petrov" "headache" ... | npm run voice:sim
 *   add --no-play to skip audio playback (still does TTS + STT).
 */
import "dotenv/config";
import { buildGraph } from "../lib/agent/graph.ts";
import type { IntakeStateType } from "../lib/agent/state.ts";
import { speakResilient, transcribeBytes, pcmToWav, config } from "../lib/openrouter.ts";
import { speakCached } from "../lib/tts-cache.ts";
import { playWav } from "../lib/audio.ts";

const PATIENT_VOICE = process.env.PATIENT_VOICE || "Puck";
const PLAY = !process.argv.includes("--no-play");

async function readStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Assistant speaks (and we hear it). Cached so fixed questions don't re-pay TTS. */
async function say(text: string): Promise<void> {
  console.log(`\n🔊 assistant: ${text}`);
  const wav = pcmToWav(await speakCached(text));
  if (PLAY) await playWav(wav);
}

/** Patient speaks (male voice); we transcribe what was heard. */
async function hear(text: string): Promise<string> {
  const wav = pcmToWav(await speakResilient(text, { voice: PATIENT_VOICE }));
  if (PLAY) await playWav(wav);
  return (await transcribeBytes(wav, "wav")).trim().replace(/[.?!]+$/, "");
}

async function main() {
  const turns = await readStdin();
  console.log(`(assistant voice: ${config.ttsVoice}, patient voice: ${PATIENT_VOICE}, playback: ${PLAY ? "on" : "off"})`);
  const graph = buildGraph();

  let state = (await graph.invoke({})) as IntakeStateType;
  await say(state.assistantMessage!);

  for (const turn of turns) {
    if (state.status === "confirmed") break;
    const heard = await hear(turn);
    console.log(`🎙️  you (spoke: "${turn}")  →  STT heard: "${heard}"`);
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
  console.log(`status: ${state.status}`);
}

main().catch((err) => {
  console.error("\n❌ voice-sim failed:\n" + (err as Error).message);
  process.exit(1);
});
