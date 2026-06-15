/**
 * One-time recorder for the landing-page DEMO. Runs the real agent on a canned
 * patient script, then renders every line to audio (patient = male voice,
 * assistant = clinic voice) into `demo/`, plus a manifest describing the
 * sequence and the form snapshot to show as each clip plays.
 *
 * The website's "Play demo" button just plays these clips and reveals the form —
 * NO model or TTS at runtime, so there are no pauses.
 *
 *   npm run demo:record
 */
import "dotenv/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildGraph } from "../lib/agent/graph.ts";
import type { IntakeStateType } from "../lib/agent/state.ts";
import { speakResilient, pcmToWav, config } from "../lib/openrouter.ts";

const OUT = "public/demo"; // served by Next at /demo/*
const PATIENT_VOICE = process.env.PATIENT_VOICE || "Puck"; // male

// A representative, happy-path conversation.
const PATIENT_TURNS = [
  "Nikita Petrov",
  "I've had a bad headache for about three days",
  "June 2nd, 2002",
  "yes, this phone is fine",
  "next Friday",
  "yes",
  "no, I don't have insurance",
  "I'm a new patient",
  "yes, that's all correct",
];

type Step = { speaker: "assistant" | "patient"; text: string; audio: string; form: Record<string, unknown> };

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const graph = buildGraph();
  const steps: Step[] = [];
  let idx = 0;

  async function record(speaker: Step["speaker"], text: string, form: Record<string, unknown>) {
    const voice = speaker === "patient" ? PATIENT_VOICE : config.ttsVoice;
    const wav = pcmToWav(await speakResilient(text, { voice }));
    const audio = `${String(idx).padStart(2, "0")}-${speaker}.wav`;
    await writeFile(join(OUT, audio), wav);
    steps.push({ speaker, text, audio, form });
    process.stdout.write(`  ${audio}: ${speaker} — "${text}"\n`);
    idx++;
  }

  let state = (await graph.invoke({})) as IntakeStateType;
  await record("assistant", state.assistantMessage!, { ...state.form });

  for (const turn of PATIENT_TURNS) {
    if (state.status === "confirmed") break;
    await record("patient", turn, { ...state.form });
    state = (await graph.invoke({
      ...state,
      userInput: turn,
      messages: state.messages.concat([{ role: "user", content: turn }]),
    })) as IntakeStateType;
    await record("assistant", state.assistantMessage!, { ...state.form });
  }

  const manifest = {
    voices: { assistant: config.ttsVoice, patient: PATIENT_VOICE },
    confirmation: state.confirmation,
    steps,
  };
  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Recorded ${steps.length} clips + manifest.json to ${OUT}/`);
}

main().catch((err) => {
  console.error("\n❌ demo-record failed:\n" + (err as Error).message);
  process.exit(1);
});
