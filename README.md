# Clinic Intake Assistant (Voice)

> Book a clinic appointment **by talking**. You speak, the assistant speaks back,
> and a patient intake form fills itself in on the right — in real time.

**▶ Play demo** — the page leads with a one-click, fully pre-recorded demonstration: a
male-voiced patient and the assistant talk through a whole booking while the intake form
fills itself in. No mic, no typing — just press play and watch. (Zero runtime model/TTS,
so it's instant.)

**Try it!** — below the demo, the patient presses one button and just *talks*. The
assistant listens, **replies out loud** (with the text shown on screen too), and the
structured US clinic intake form on the right populates as the conversation goes. When the
form is complete, it submits and returns a confirmation number.

To keep the live flow snappy, the assistant's wording is fixed templates (the model is only
used to understand the patient, not to speak), and fixed-phrase audio is pre-rendered/cached.

This is a **voice-first** experience, not a chatbot. Speech is the primary interface; the
on-screen transcript and form are the visual mirror of the conversation.

This repository currently contains the **specification only** (Markdown). No application
code has been written yet — these documents define what to build and how.

---

## What it is

A small, mostly-frontend web app for **US clinics**. A patient who wants to be seen
**speaks** to an AI intake assistant in plain English. The assistant **answers with
voice**, asks the questions a US front desk would ask (demographics, contact, insurance,
reason for visit, consents), validates each answer, and re-asks intelligently when
something looks wrong — for example, if a transcribed answer doesn't look like a real
name, it asks the patient to **spell it out letter by letter**.

The whole voice loop runs through **OpenRouter**: speech-to-text, the LLM that drives the
conversation (orchestrated by **LangGraph.js**), and text-to-speech for the reply.

## The voice loop

```
🎙️ patient speaks
   → OpenRouter STT (transcription)
      → LangGraph agent (LLM: extract · validate · decide next question)
         → assistant reply text  ──→ shown on screen (caption) + fills the form
            → OpenRouter TTS (speech)
               → 🔊 assistant speaks  → back to the patient
```

## The screen, at a glance

```
┌───────────────────────────────────────────────────────────────────┐
│  Clinic Intake Assistant                                  Try it!   │
├───────────────────────────────┬───────────────────────────────────┤
│                               │  Patient Intake          6 / 14 ▰▰▱ │
│         (  🎤  )              │  ── Demographics ──                 │
│       Tap to talk             │  Legal name      Jane A. Doe        │
│                               │  Date of birth   05/14/1990         │
│   🔊 "What's your full        │  ── Contact ──                      │
│       legal name?"            │  Mobile          (415) 555-0142     │
│   🗣️ "Jane Doe"  (live)       │  ── Insurance ──                    │
│                               │  Carrier         …                  │
│   live transcript ↑           │                       [ Submit ]    │
└───────────────────────────────┴───────────────────────────────────┘
   left: voice + live transcript    right: live intake form
```

## Tech stack (and why)

Choices follow the most recent **Stack Overflow Developer Survey** (TypeScript, React,
Next.js, and Tailwind CSS remain the most widely used web technologies) and the design
skills installed in this repo. All AI runs through **OpenRouter**.

| Concern              | Choice                                                       |
| -------------------- | ------------------------------------------------------------ |
| Language             | TypeScript                                                   |
| Framework            | Next.js (App Router) + React                                 |
| Backend              | Next.js Route Handlers — minimal, no separate server         |
| Mic capture / audio  | Browser `MediaRecorder` + Web Audio (playback)               |
| Speech-to-text       | OpenRouter `/audio/transcriptions` (`openai/gpt-4o-transcribe`) |
| LLM brain            | LangGraph.js + LangChain.js → OpenRouter (`anthropic/claude-opus-4.8`) |
| Text-to-speech       | OpenRouter `/audio/speech` (`google/gemini-3.1-flash-tts-preview`) |
| Styling              | Tailwind CSS                                                 |
| Components           | shadcn/ui (Radix primitives)                                 |
| Animation            | Motion (Framer Motion), Sonner (toasts), Vaul (drawer)       |
| Forms / validation   | react-hook-form + Zod                                        |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full rationale.

## Specification

- [docs/SPEC.md](docs/SPEC.md) — product, scope, the voice UX, and the conversation flow
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, the voice loop, LangGraph agent, OpenRouter, env
- [docs/INTAKE_FORM.md](docs/INTAKE_FORM.md) — every intake field (US-specific) + validation
- [docs/DESIGN.md](docs/DESIGN.md) — design system, layout, and motion
- [docs/PLAN.md](docs/PLAN.md) — PoC-first build plan (prove the voice pipeline before the UI)

## Configuration

All AI calls go through OpenRouter. Copy the example env file and paste your token:

```
cp .env.example .env.local
```

Set `OPENROUTER_API_KEY`; the LLM / STT / TTS model ids are pre-filled in
[.env.example](.env.example) and can be swapped without code changes. `.env.local` is read
by Next.js and is git-ignored.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for validators + schema. |
| `npm run chat` / `npm run sim` | Text agent — interactive REPL / scripted (stdin). |
| `npm run voice:sim` | Automated voice round-trip (synth patient → STT → agent → TTS). |
| `npm run voice` | Live mic conversation (auto-detects your microphone). |
| `npm run demo:record` | Generate the landing demo clips + manifest into `demo/` (one-time). |
| `npm run demo:play` | Play the pre-recorded demo (captions + form fill). |
| `npm run server` | Start the HTTP API (`/api/chat`, `/transcribe`, `/speak`, `/submit`). |
| `npm run verify:api` | Smoke-test all four endpoints against a running server. |
| `npm run graph` | Render the LangGraph agent (Mermaid + `graph.png`). |

## Design skills

This repo has the **emil-design-eng**, **impeccable**, and **taste-skill** skills
installed. Use them while building the UI: `emil-design-eng` for animation/easing,
`impeccable` (`/polish`) for typography and spacing, and the taste skills to keep the
result from looking generically "AI-made." See [docs/DESIGN.md](docs/DESIGN.md).
