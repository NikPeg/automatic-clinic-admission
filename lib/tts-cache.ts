/**
 * Disk cache for TTS audio. The assistant's questions are FIXED template strings
 * (see lib/agent/nodes.ts), so their audio only needs to be generated once —
 * after that we replay the cached bytes instead of paying the TTS latency again.
 * Only genuinely dynamic phrases (resolved dates, the summary, the confirmation
 * number) are synthesized live.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { speakResilient, config } from "./openrouter.ts";

const DIR = ".cache/tts";

function keyFor(text: string, voice: string): string {
  return createHash("sha1").update(`${config.ttsModel()}|${voice}|${text}`).digest("hex");
}

/** Return PCM for `text`, from the on-disk cache when available. */
export async function speakCached(text: string, opts: { voice?: string } = {}): Promise<Buffer> {
  const voice = opts.voice ?? config.ttsVoice;
  const file = join(DIR, `${keyFor(text, voice)}.pcm`);
  if (existsSync(file)) return readFile(file);
  const pcm = await speakResilient(text, { voice });
  await mkdir(DIR, { recursive: true });
  await writeFile(file, pcm);
  return pcm;
}
