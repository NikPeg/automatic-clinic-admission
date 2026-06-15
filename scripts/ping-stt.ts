/** Phase 0 — prove the STT endpoint works. Transcribes out.mp3 (from ping:tts). */
import "dotenv/config";
import { existsSync } from "node:fs";
import { transcribe, config } from "../lib/openrouter.ts";

const IN = process.argv[2] ?? "out.wav";

async function main() {
  if (!existsSync(IN)) {
    throw new Error(
      `Audio file "${IN}" not found. Run \`npm run ping:tts\` first to create out.wav, ` +
        `or pass a path: \`npm run ping:stt -- path/to/audio.wav\`.`,
    );
  }
  console.log(`→ STT model: ${config.sttModel()}  file: ${IN}`);
  const text = await transcribe(IN);
  console.log("\n✅ Transcript:\n" + text + "\n");
}

main().catch((err) => {
  console.error("\n❌ STT ping failed:\n" + (err as Error).message);
  process.exit(1);
});
