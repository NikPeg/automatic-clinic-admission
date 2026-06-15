/**
 * Thin OpenRouter client for the voice loop.
 *
 * All three call types go through OpenRouter's OpenAI-compatible base URL:
 *   - chat()       → POST /chat/completions      (LLM brain)
 *   - speak()      → POST /audio/speech          (text-to-speech)
 *   - transcribe() → POST /audio/transcriptions  (speech-to-text)
 *
 * Note: the STT endpoint is NOT OpenAI-SDK compatible (it takes base64 JSON,
 * not a multipart upload), so we use plain fetch everywhere for consistency.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env (copy from .env.example).`,
    );
  }
  return value;
}

export const config = {
  baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  get apiKey() {
    return required("OPENROUTER_API_KEY");
  },
  llmModel: () => required("OPENROUTER_LLM_MODEL"),
  sttModel: () => required("OPENROUTER_STT_MODEL"),
  ttsModel: () => required("OPENROUTER_TTS_MODEL"),
  ttsVoice: process.env.OPENROUTER_TTS_VOICE || "alloy",
  siteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
  appTitle: process.env.OPENROUTER_APP_TITLE || "Clinic Intake Assistant",
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    // OpenRouter attribution headers (optional but recommended).
    "HTTP-Referer": config.siteUrl,
    "X-Title": config.appTitle,
    ...extra,
  };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter ${path} failed: ${res.status} ${res.statusText}\n${detail}`,
    );
  }
  return res;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Run a chat completion. Returns the assistant's reply text.
 *  Retries transient provider hiccups (timeouts / empty completions). */
export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; retries?: number } = {},
): Promise<string> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await postJson("/chat/completions", {
        model: config.llmModel(),
        messages,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      });
      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
      };
      const text = data.choices?.[0]?.message?.content;
      if (text != null) return text;
      // Provider returned an error/empty completion (e.g. upstream timeout) — retry.
      lastErr = new Error(`Empty completion (finish_reason=${data.choices?.[0]?.finish_reason ?? "?"})`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw new Error(`chat() failed after ${retries + 1} attempts: ${(lastErr as Error).message}`);
}

/** Synthesize speech. Returns the raw audio bytes (PCM by default for Gemini TTS). */
export async function speak(
  text: string,
  opts: { voice?: string; format?: "mp3" | "pcm" } = {},
): Promise<Buffer> {
  const res = await postJson("/audio/speech", {
    model: config.ttsModel(),
    input: text,
    voice: opts.voice ?? config.ttsVoice,
    response_format: opts.format ?? "pcm",
  });
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Wrap raw PCM (signed 16-bit little-endian) in a WAV container so it can be
 * played and transcribed. Gemini TTS returns 24 kHz / 16-bit / mono PCM.
 */
export function pcmToWav(
  pcm: Buffer,
  { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {},
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Like speak(), but works around a Gemini TTS quirk: bare space-separated digit
 * groups (e.g. "06 02 2002") return empty audio. Retries with speakable variants
 * that preserve the meaning. Returns non-empty PCM or throws.
 */
export async function speakResilient(
  text: string,
  opts: { voice?: string } = {},
): Promise<Buffer> {
  const variants = [text, text.replace(/(\d)\s+(\d)/g, "$1/$2"), `It's ${text}`];
  for (const v of variants) {
    const pcm = await speak(v, opts);
    if (pcm.length > 0) return pcm;
  }
  throw new Error(`TTS produced no audio for: ${JSON.stringify(text)}`);
}

const FORMAT_BY_EXT: Record<string, string> = {
  ".mp3": "mp3",
  ".wav": "wav",
  ".flac": "flac",
  ".m4a": "m4a",
  ".ogg": "ogg",
  ".webm": "webm",
  ".aac": "aac",
};

/** Transcribe raw audio bytes of a known format. Returns the transcribed text. */
export async function transcribeBytes(
  data: Buffer,
  format: string,
  language = "en",
): Promise<string> {
  // A bare WAV header (~44 bytes) means there's no audio — surface a clear error
  // instead of the provider's opaque 400.
  if (data.length <= 64) {
    throw new Error("Empty audio — nothing to transcribe (the TTS step produced no output).");
  }
  const res = await postJson("/audio/transcriptions", {
    model: config.sttModel(),
    // Force English so US names aren't transcribed into other scripts.
    language,
    input_audio: { data: data.toString("base64"), format },
  });
  const json = (await res.json()) as { text?: string };
  if (json.text == null) {
    throw new Error(`Unexpected STT response shape: ${JSON.stringify(json)}`);
  }
  return json.text;
}

/** Transcribe an audio file. Returns the transcribed text. */
export async function transcribe(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const format = FORMAT_BY_EXT[ext];
  if (!format) {
    throw new Error(`Unsupported audio extension "${ext}" for ${filePath}`);
  }
  return transcribeBytes(await readFile(filePath), format);
}
