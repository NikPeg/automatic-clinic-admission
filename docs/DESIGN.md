# Design

This is a **voice-first** experience: the patient talks, the assistant talks back, and the
screen is the calm visual mirror of that conversation (live transcript on the left, form
filling on the right). The UI must feel **calm, trustworthy, and modern** — clinical but
warm — and visibly reward the patient as the form fills in. It must **not** look generically
"AI-made" (no default purple gradients, no over-glassed cards).

Build it with the installed skills: **emil-design-eng** (animation & easing),
**impeccable** / `/polish` (typography & spacing), and the **taste** skills (real design
references, anti-generic visuals).

## Frameworks

- **Tailwind CSS** — utility styling, design tokens via CSS variables.
- **shadcn/ui** (Radix primitives) — accessible, ownable components (button, input,
  card, select, drawer, badge, progress).
- **Motion** (Framer Motion) — the field-fill and message animations.
- **Sonner** — success/error toasts (e.g. on submit). **Vaul** — the mobile intake drawer.
- **Lucide** — icons.

## Layout

- Full-height two-panel split. On desktop roughly **45% voice / 55% intake**; the intake
  side is wider so the form is comfortable to read.
- **Header:** product name (left), small **"Try it!"** badge (right).
- **Left (voice surface):** inviting empty state with a single primary **mic / "Tap to
  talk"** button; after start, a prominent mic control, an **audio-level / waveform
  indicator**, and a rolling **transcript** of both sides (assistant captions + the
  patient's transcribed speech). A small **text fallback input** sits at the bottom.
- **Right (intake):** a card with section headers (Demographics, Contact, Insurance,
  Visit, Emergency & Consents), a `N / total` progress bar at the top, and a **Submit**
  CTA at the bottom that activates when complete.
- **Mobile:** the voice surface is full-screen; the intake form lives in a bottom drawer
  (Vaul) with the progress bar pinned so progress is always visible.

## Voice states (must be legible at a glance)

The mic control is the emotional center of the screen; its state must always be obvious:

- **Idle** — calm mic button, "Tap to talk."
- **Listening** — mic active, live audio-level ring/waveform responding to the voice.
- **Thinking** — transcribing + agent working; a subtle pulsing/indeterminate indicator.
- **Speaking** — assistant TTS playing; the current caption is highlighted, with a gentle
  speaking animation. Tapping the mic interrupts (barge-in).
- **Error** — mic denied / "I didn't catch that" — clear, non-alarming recovery prompt.

## Visual language

- **Palette:** soft off-white surfaces, slate/ink text, **one** trustworthy accent
  (teal or blue). Use color sparingly — accent for confirmed fields, progress, and the
  primary CTA only.
- **Shape & depth:** `rounded-2xl` cards, 1px hairline borders, soft low shadows. Avoid
  heavy glassmorphism.
- **Typography:** a clean modern sans (Geist or Inter). Clear hierarchy; **tabular
  numbers** for dates, phone, IDs, and the progress count. Run `/polish` (impeccable) to
  tighten rhythm and spacing.
- **Whitespace:** generous and consistent; let sections breathe.

## Motion (emil-design-eng)

- **Purposeful and fast:** enter transitions ~150–250ms, ease-out. Nothing should feel
  sluggish or decorative-for-its-own-sake.
- **Field lands:** when a field is confirmed, it animates in with a subtle
  opacity + slight upward translate, and a brief accent flash on the value. The progress
  bar advances with a small spring.
- **Voice:** captions appear as the assistant speaks (synced to TTS where possible); the
  audio-level ring reacts live while listening; "thinking" uses a calm indeterminate pulse.
- **Reduced motion:** honor `prefers-reduced-motion` — replace movement with simple
  fades.

## Accessibility

- WCAG AA contrast throughout; visible focus rings; full keyboard navigation.
- Assistant captions in an **ARIA live region** so screen readers announce them; the full
  experience must be usable **without audio** (captions + text fallback input) and
  **without a mic** (typed answers).
- Every intake field has a real label; the form is readable independent of color (don't
  rely on the accent alone to signal "confirmed").

## Anti-"AI look" checklist (taste skills)

- No default purple→blue hero gradient; no random emoji sprinkling.
- Pull from real medical/scheduling product references, not generic dashboard templates.
- Restrained palette, intentional spacing, one accent — not five.
- Copy is plain and human ("What's your full legal name?"), not robotic.
