/** Phase 0 — prove the TTS endpoint works. Writes out.wav. */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { speak, pcmToWav, config } from "../lib/openrouter.ts";

const OUT = ".artifacts/out.wav";

async function main() {
  console.log(`→ TTS model: ${config.ttsModel()}  voice: ${config.ttsVoice}`);
  const text =
    "Hi! Welcome to the clinic. Let's get you booked. What's your full legal name?";
  // Gemini TTS only supports PCM; wrap it in a WAV header so it's playable.
  const pcm = await speak(text);
  const wav = pcmToWav(pcm);
  await mkdir(".artifacts", { recursive: true });
  await writeFile(OUT, wav);
  console.log(
    `\n✅ Wrote ${OUT} (${wav.length} bytes). Play it:\n   open ${OUT}\n`,
  );
}

main().catch((err) => {
  console.error("\n❌ TTS ping failed:\n" + (err as Error).message);
  console.error(
    "\nHint: if the error mentions an invalid voice, set OPENROUTER_TTS_VOICE in .env\n" +
      "to a voice this model supports (see the model's page on openrouter.ai).",
  );
  process.exit(1);
});
