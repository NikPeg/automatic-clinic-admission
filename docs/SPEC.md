# Product Specification

## 1. Summary

A small web app that lets a patient self-schedule at a **US clinic** by **voice**. The
patient **speaks**; the assistant **speaks back** (with the text also shown on screen);
and a structured intake form mirrors the conversation in real time. This is a
**voice-first** product — the core challenge and the core value is the spoken
back-and-forth, not a text chat.

The app is **frontend-first** with a **minimal backend** (a few Next.js Route Handlers).
The entire voice loop runs through **OpenRouter**: speech-to-text, the LLM that drives the
conversation (orchestrated by **LangGraph.js**), and text-to-speech.

## 2. Goals

- Let a patient complete a clinic intake **by talking**, hands-light.
- The assistant **responds in voice**; its words also appear on screen as captions.
- Show progress visibly: the right-hand form fills in live as answers are confirmed.
- Ask **US-specific** questions in **English** (insurance, SSN last-4, US address, etc.).
- Handle imperfect speech/transcription and **re-ask intelligently** — e.g. spell-by-letter
  when a transcribed answer doesn't look like a name.
- Keep the backend tiny: no database required; submission returns a mock confirmation.
- **Feel responsive.** Lead with a zero-latency pre-recorded demo; in the live flow, the
  assistant's wording is fixed templates (not model-generated) and fixed-phrase audio is
  pre-rendered/cached, so the model is only on the path for understanding the patient, not
  for speaking. See [ARCHITECTURE.md](ARCHITECTURE.md) §3a.

## 3. Non-goals

- No real EHR / scheduling-system integration (submission is mocked).
- No authentication or patient accounts.
- No persistence beyond the active session.
- Not a HIPAA-certified product; consent screens are illustrative (see §9).

## 4. Layout & UX

Single full-height screen. The left column has two stacked sections — **the demo
comes first, the live "Try it!" second** — and the right column is the live intake form.

### 4.0 Demo (the first thing the visitor sees) — "▶ Play demo"

Most visitors won't want to talk right away, so the page leads with a one-click
**pre-recorded demonstration**. Pressing **Play** runs a scripted call: a (male-voiced)
patient speaks and the assistant answers — **both sides are pre-recorded audio** — while
the intake form on the right fills in step by step. It shows, in ~30 seconds and zero
effort, exactly what the product does.

- The demo is **pre-rendered audio clips + a manifest** (see [ARCHITECTURE.md](ARCHITECTURE.md)):
  **no microphone, no speech-to-text, no model calls, no TTS at runtime** — so it's instant
  and identical every time.
- Standard transport controls (play / pause / restart). The form mirrors the manifest's
  per-step snapshot, animating each field in as its answer is "spoken."

Below the demo sits the live experience:

- **Header** — product name on the left, a small **"Try it!"** badge on the right.
- **Left panel — the live voice surface ("Try it!").** Starts as an inviting empty state with one primary
  **microphone / "Tap to talk"** button. The patient speaks; the assistant speaks back.
  The panel shows: a mic/record control, a live audio level / waveform indicator, and a
  rolling **transcript** of both sides (assistant lines and the patient's transcribed
  speech). A small **text input remains available** as a fallback (accessibility / noisy
  environments).
- **Right panel — the live intake form.** A card grouped into sections (Demographics,
  Contact, Insurance, Visit, Emergency & Consents). Each field shows its current value,
  empty until the assistant confirms it. A confirmed field animates in (see
  [DESIGN.md](DESIGN.md)). A progress indicator shows `N / total` completed. A **Submit**
  button becomes active once all required fields are filled.

Responsive: on narrow screens the voice surface is primary and the intake form is reachable
via a bottom drawer (Vaul), with the progress indicator always visible.

## 5. Interaction model (voice)

- **Push-to-talk** for the PoC: the patient taps the mic to start recording, taps again
  (or it auto-stops on silence) to send. This is the most reliable starting point;
  hands-free voice-activity detection (VAD) is a later enhancement (see [PLAN.md](PLAN.md)).
- While the patient speaks, audio is captured in the browser (`MediaRecorder`).
- The recording is transcribed (OpenRouter STT) and the transcript appears in the
  transcript list as the patient's line.
- The assistant's reply text appears as a caption **and** is spoken aloud (OpenRouter TTS).
- **Barge-in / interrupt** (nice-to-have): tapping the mic while the assistant is speaking
  stops playback so the patient can talk.

## 6. Primary user flow

1. Patient opens the app and presses **Tap to talk** (grants mic permission once).
2. Assistant greets **out loud** and asks the first question (full legal name); the caption
   shows the same text.
3. For each field: patient speaks → audio transcribed → assistant extracts the value →
   validates it → either confirms (form updates on the right, assistant advances) or asks a
   clarifying / correcting question — all spoken and captioned.
4. After all required fields are collected, the assistant **reads back a summary** aloud and
   asks the patient to confirm.
5. On confirmation, the app submits and shows a **confirmation number** plus the requested
   appointment details, and announces it by voice. A success toast (Sonner) fires.

The full field list and validation rules live in [INTAKE_FORM.md](INTAKE_FORM.md). The
agent's internal logic lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## 7. Conversational behavior (key requirement)

The assistant must handle messy, **spoken** answers and transcription noise, not just clean
text:

- **Doesn't look like a name** (transcription unclear, gibberish, numbers) → "I want to make
  sure I spell this correctly — could you **spell your first name letter by letter**?" The
  patient says the letters; the next transcription is reconstructed into a name and read
  back for confirmation.
- **Wrong format** (date, phone, ZIP) → re-ask by voice with a spoken example of the
  expected format.
- **Ambiguous or multiple answers at once** → extract what it can, then ask only for what's
  still missing or unclear.
- **Misheard / low-confidence transcript** → confirm by reading it back ("I heard … — is
  that right?") before committing.
- **Out of scope / chit-chat** → briefly acknowledge, then steer back to the next field.
- **Correction** ("actually my last name is …") → update the already-filled field and reflect
  the change on the form.

## 8. States to design

- Empty / pre-start (the "Try it!" invitation, mic permission prompt).
- Listening (recording, audio-level indicator).
- Thinking (transcribing + agent working).
- Speaking (assistant TTS playing, caption highlighted).
- Clarification / error (spell-by-letter, format hint, "I didn't catch that").
- Review & confirm (spoken summary read-back).
- Submitted (confirmation number + success toast + spoken confirmation).
- Failure (mic denied, model/network error — graceful spoken + on-screen retry message).

## 9. Privacy note

This is a demo. The intake captures sensitive data (DOB, SSN last-4, insurance) **and
microphone audio**. Treat it accordingly: request mic permission explicitly, never log raw
audio or raw field values, keep state in-session, and present the HIPAA / consent
acknowledgements as part of the flow. SSN last-4 is **optional**. Nothing here should be
considered a substitute for a HIPAA compliance review before any real use.
