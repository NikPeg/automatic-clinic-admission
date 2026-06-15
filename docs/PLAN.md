# Build Plan (PoC-first)

This is a **voice-first** app, so the main risk is the **voice loop** (speech-in →
understanding → speech-out) and the registration pipeline behind it. The point of this plan
is to **prove those work before any UI is built**. We work back-to-front: get the
OpenRouter STT → LLM → TTS loop and the LangGraph intake agent running and verifiable in the
terminal, then — only once you've confirmed they actually work — wrap them in the API and
the frontend.

Each phase has an explicit **checkpoint** for you to verify. We stop at each checkpoint so
you can catch problems early instead of debugging a finished app.

---

## Phase 0 — Connectivity: all three OpenRouter endpoints

**Goal:** prove we can reach OpenRouter for **LLM, STT, and TTS** with your key.

- Init a Next.js + TypeScript project, add Tailwind. (No UI yet beyond the default.)
- Add `@langchain/langgraph`, `@langchain/core`, `@langchain/openai`, `zod`.
- `lib/openrouter.ts` — one OpenAI-compatible client at `OPENROUTER_BASE_URL`, with helpers
  for chat, transcription, and speech.
- Three tiny scripts:
  - `scripts/ping-llm.ts` — send a prompt, print the reply.
  - `scripts/ping-tts.ts` — turn a sentence into `out.mp3` (OpenRouter TTS).
  - `scripts/ping-stt.ts` — send `out.mp3` (or any wav) to OpenRouter STT, print transcript.

**✅ Checkpoint 0:** all three scripts succeed — you read an LLM reply, you can **play
`out.mp3` and hear the voice**, and the STT script prints back the right words. This
confirms your token, base URL, and the LLM/STT/TTS model ids in `.env` all work. This is the
first place the voice idea is de-risked.

---

## Phase 1 — Intake schema & validators (no model)

**Goal:** lock down *what* we collect and *how* we validate it, in isolation.

- `lib/schema.ts` — the Zod intake schema (fields from [INTAKE_FORM.md](INTAKE_FORM.md)).
- `lib/validation.ts` — deterministic validators (DOB `MM/DD/YYYY`, US phone, ZIP, state
  code, email, "looks like a name") and a US-format normalizer.
- A small unit test file exercising good/bad inputs.

**✅ Checkpoint 1:** validator tests pass — phone/date/ZIP normalize correctly and gibberish
names are flagged. No model involved, so this is fast and deterministic.

---

## Phase 2 — The agent pipeline, headless & text-only

**Goal:** the whole registration conversation works **in the terminal as text** (no audio
yet), so we isolate the *reasoning* from the *voice* before combining them.

- `lib/agent/state.ts` — graph state (messages, form, currentField, status, clarification).
- `lib/agent/nodes.ts` — `extract`, `validate`, `clarify`, `advance`, `review`, `submit`.
- `lib/agent/graph.ts` — wire the nodes with conditional edges (see
  [ARCHITECTURE.md](ARCHITECTURE.md) §5).
- `scripts/chat-cli.ts` — a REPL: you type as the patient, it asks the next question, fills
  the form, and prints the current form state after each turn.

**✅ Checkpoint 2:** in the terminal you can:
1. Complete a full happy-path intake and get a confirmation number.
2. Type a non-name (e.g. `123` / `asdfgh`) and watch it **ask you to spell it letter by
   letter**, then reconstruct and read it back.
3. Give a malformed date/phone and watch it re-ask with the correct example format.
4. Correct an earlier answer and see the form update.

---

## Phase 3 — Headless **voice** round-trip (the key PoC)

**Goal:** prove the **full voice loop** end-to-end with **no frontend** — this is the
project's main difficulty, so we de-risk it here.

- `scripts/voice-cli.ts` — a loop that, each turn:
  1. takes an input audio file (pre-recorded clip, or recorded from the mic via a small
     helper),
  2. transcribes it via OpenRouter STT,
  3. feeds the transcript to the **same** LangGraph agent from Phase 2,
  4. sends the reply to OpenRouter TTS and **plays the audio** (and prints the caption),
  5. repeats.
- Provide a few sample clips (a name, a spelled-out name, a date) so the run is repeatable.

**✅ Checkpoint 3 — the important one.** Speaking (or feeding clips) to the terminal, you can
hear the assistant **ask and answer by voice** and watch the form fill: a normal answer is
accepted; an unclear "name" makes it **ask you to spell it out**, and spelling it works; a
spoken date in the wrong shape gets a spoken re-ask. **We do not start the frontend until
you sign off here.**

---

## Phase 4 — Minimal API

**Goal:** expose the proven pipeline over HTTP, unchanged.

- `app/api/transcribe/route.ts`, `app/api/chat/route.ts`, `app/api/speak/route.ts`,
  `app/api/submit/route.ts` (see [ARCHITECTURE.md](ARCHITECTURE.md) §4). They reuse the
  Phase 2–3 logic; nothing is rewritten.

**✅ Checkpoint 4:** HTTP calls reproduce the CLI behavior — `/api/transcribe` returns text,
`/api/chat` advances the intake, `/api/speak` returns playable audio.

---

## Phase 5 — Voice UX exploration (pick the interaction model) ⏳ may take a while

**Goal:** decide *how* talking to the app should feel. Push-to-talk (from the spec) is the
safe default, but it may feel clunky — so this phase builds **several interaction variants
as playable prototypes** and you choose the best one by actually using them. This is
explicitly an **open-ended, iterative phase**: expect a few rounds of "try it → feedback →
adjust," and it may take longer than the others.

- **The page leads with the pre-recorded demo** ("▶ Play demo"), *above* the live "Try it!"
  section — most visitors would rather watch than talk. The demo assets already exist
  (`npm run demo:record` → `demo/` + manifest; `npm run demo:play` is the terminal preview),
  so this phase is mostly wiring the manifest to an audio player + the animating form.
- Build a thin throwaway-ish frontend wired to the Phase 4 API for the live part, with the
  voice interaction mode **switchable** so the same conversation can be driven different
  ways. Candidate variants:
  1. **Push-to-talk** — tap to start, tap to stop (baseline).
  2. **Hold-to-talk** — press and hold while speaking, release to send (walkie-talkie).
  3. **Hands-free / VAD** — always listening, auto-detects when you start/stop speaking,
     with **barge-in** (talk over the assistant to interrupt).
  4. **Hybrid** — hands-free with a visible mic toggle to mute/take control.
- Keep the visuals deliberately rough here; we're judging *feel* (latency, turn-taking,
  how natural it is), not polish.

**✅ Checkpoint 5:** you try the variants in the browser and tell me which interaction model
(or combination) feels best. **We lock the interaction design here before investing in the
polished UI.** No fixed end date — we iterate until you're happy.

---

## Phase 6 — Production frontend

**Goal:** build the chosen interaction into the polished two-panel UI from
[SPEC.md](SPEC.md) / [DESIGN.md](DESIGN.md).

- **Left column, top: the pre-recorded demo** (`demo/manifest.json` + clips) with play /
  pause / restart; the form animates from each step's snapshot.
- **Left column, below: the live "Try it!"** surface (using the interaction model picked in
  Phase 5): mic control, audio-level indicator, live transcript, caption of the assistant's
  spoken reply, text fallback input.
- Right live intake card: sections, `N / total` progress, Submit.
- Clear listening / thinking / speaking states.
- **Responsiveness:** assistant wording stays template-based; serve fixed-phrase audio from
  the TTS cache (`lib/tts-cache.ts`) and only synthesize dynamic lines live (see
  [ARCHITECTURE.md](ARCHITECTURE.md) §3a).
- Polish with the design skills: `emil-design-eng` (motion), `/polish` (impeccable), taste
  skills (anti-generic look).

**✅ Checkpoint 6:** end-to-end in the browser — you talk, the assistant talks back, captions
and the form update live, submission shows a confirmation toast, and it looks finished.

---

## Phase 7 — Hardening (optional)

- Refine whatever the chosen interaction model still needs (e.g. tuned VAD thresholds).
- Reduced-motion + accessibility pass, mic-denied / error / retry states, mobile drawer (Vaul).
- Don't-log-sensitive-data check (raw audio, SSN last-4, insurance IDs).

---

## How we'll work

- We stop at each **✅ Checkpoint** for your review before moving on.
- **Checkpoint 0** proves the voice endpoints exist and work; **Checkpoint 3** proves the
  full headless voice loop; **Checkpoint 5** is where you pick how talking should feel
  (open-ended, may take a while). The polished UI (Phase 6) starts only after that.
- Prerequisite for Phase 0: `OPENROUTER_API_KEY` plus the LLM/STT/TTS model ids in `.env`
  (already filled in).
