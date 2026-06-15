/**
 * Framework-agnostic API handlers. Each takes a parsed JSON body and returns a
 * plain object. The standalone Node server (scripts/server.ts) wires these to
 * routes today; Next.js route handlers can call the exact same functions later —
 * no logic lives in the transport layer.
 *
 * The conversation is stateless on the server: the client passes the prior graph
 * `state` back on each /chat call and gets the updated state in return.
 */
import { buildGraph } from "./agent/graph.ts";
import type { IntakeStateType } from "./agent/state.ts";
import { transcribeBytes, pcmToWav, speak } from "./openrouter.ts";
import { speakCached } from "./tts-cache.ts";
import { IntakeSchema } from "./schema.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const graph = buildGraph();

/** One conversation turn. Body: { state?, userInput? }. First turn: send {}. */
export async function chatTurn(body: { state?: IntakeStateType; userInput?: string } = {}) {
  const { state, userInput } = body;
  const input = state
    ? {
        ...state,
        userInput: userInput ?? null,
        messages: (state.messages ?? []).concat(userInput ? [{ role: "user", content: userInput }] : []),
      }
    : {}; // first turn → greeting
  const next = (await graph.invoke(input as Partial<IntakeStateType>)) as IntakeStateType;
  return {
    state: next,
    message: next.assistantMessage,
    // "done" = the conversation has ended (after the post-booking farewell), so
    // the client can stop listening. Booking itself is signalled by confirmation.
    done: next.status === "done",
    confirmation: next.confirmation ?? null,
  };
}

/** Speech-to-text. Body: { audioBase64, format? }. */
export async function transcribeTurn(body: { audioBase64?: string; format?: string }) {
  if (!body.audioBase64) throw new HttpError(400, "audioBase64 is required");
  const text = await transcribeBytes(Buffer.from(body.audioBase64, "base64"), body.format ?? "wav");
  return { text: text.trim().replace(/[.?!]+$/, "") };
}

/** Text-to-speech. Body: { text, voice? } → WAV (base64). Fixed phrases are cached. */
export async function speakTurn(body: { text?: string; voice?: string }) {
  if (!body.text) throw new HttpError(400, "text is required");
  const pcm = body.voice ? await speak(body.text, { voice: body.voice }) : await speakCached(body.text);
  return { audioBase64: pcmToWav(pcm).toString("base64"), format: "wav" };
}

/** Validate the finished intake and issue a (mock) confirmation. Body: { form }. */
export function submitTurn(body: { form?: unknown }) {
  const parsed = IntakeSchema.safeParse(body.form);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  return { ok: true, confirmation: "CLN-" + Math.random().toString(36).slice(2, 8).toUpperCase() };
}
