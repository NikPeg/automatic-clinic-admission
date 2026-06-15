"use client";

import { useEffect, useRef, useState } from "react";
import { IntakeForm } from "./IntakeForm.tsx";

type Line = { role: "assistant" | "patient"; text: string };
type Step = { speaker: "assistant" | "patient"; text: string; audio: string; form: Record<string, unknown> };
type Mode = "idle" | "demo" | "live";
type LiveStatus = "idle" | "connecting" | "listening" | "capturing" | "thinking" | "speaking";

// Voice-activity-detection thresholds (RMS) and timings. One threshold is used
// for both onset and end (no gray zone), so short words like "yes" finalize.
const SPEECH_ON = 0.03; // at/above = speech; below = silence
const SILENCE_MS = 1200; // finalize after this much trailing silence
const MIN_SPEECH_MS = 140; // ignore blips shorter than this
const BARGE_IN = 0.06; // talk over the assistant to interrupt it
const PREROLL_FRAMES = 4; // keep ~0.3s before onset so word starts aren't clipped

export function Experience() {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");

  // demo
  const [steps, setSteps] = useState<Step[]>([]);
  const [demoIdx, setDemoIdx] = useState(-1);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // live
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("idle");
  const stateRef = useRef<any>(null);
  const micBtnRef = useRef<HTMLButtonElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // audio graph / VAD refs
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionRef = useRef(false);
  const capturingRef = useRef(false);
  const speakingRef = useRef(false);
  const bufRef = useRef<Float32Array[]>([]);
  const preRollRef = useRef<Float32Array[]>([]);
  const speechMsRef = useRef(0);
  const silenceStartRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const statusRef = useRef<LiveStatus>("idle");

  function setStatus(s: LiveStatus) {
    statusRef.current = s;
    setLiveStatus(s);
  }

  useEffect(() => {
    fetch("/demo/manifest.json").then((r) => r.json()).then((m) => setSteps(m.steps ?? [])).catch(() => {});
    return () => teardownLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  function reset() {
    playingRef.current = false;
    audioRef.current?.pause();
    setLines([]);
    setConfirmation(null);
    setForm({});
  }

  // ---------------- demo ----------------
  function playClip(file: string): Promise<void> {
    return new Promise((resolve) => {
      const a = new Audio(`/demo/${file}`);
      audioRef.current = a;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }
  async function playDemoFrom(start: number) {
    playingRef.current = true;
    setDemoPlaying(true);
    for (let i = start; i < steps.length; i++) {
      if (!playingRef.current) return;
      setDemoIdx(i);
      setForm(steps[i].form);
      setLines((p) => [...p, { role: steps[i].speaker, text: steps[i].text }]);
      await playClip(steps[i].audio);
    }
    playingRef.current = false;
    setDemoPlaying(false);
  }
  function toggleDemo() {
    teardownLive();
    if (demoPlaying) {
      playingRef.current = false;
      setDemoPlaying(false);
      audioRef.current?.pause();
      return;
    }
    if (mode !== "demo" || demoIdx >= steps.length - 1) {
      reset();
      setMode("demo");
      setDemoIdx(-1);
      void playDemoFrom(0);
    } else {
      void playDemoFrom(demoIdx);
    }
  }

  // ---------------- live (always-listening) ----------------
  function playB64(b64: string): Promise<void> {
    return new Promise((resolve) => {
      const a = new Audio(`data:audio/wav;base64,${b64}`);
      ttsAudioRef.current = a;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }
  async function speak(text: string) {
    setStatus("speaking");
    speakingRef.current = true;
    try {
      const r = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const { audioBase64 } = await r.json();
      if (audioBase64) await playB64(audioBase64);
    } catch {}
    speakingRef.current = false;
    if (sessionRef.current) setStatus("listening");
  }

  async function startLive() {
    teardownLive();
    reset();
    setMode("live");
    setStatus("connecting");
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await r.json();
      stateRef.current = data.state;
      setForm(data.state.form);
      setLines([{ role: "assistant", text: data.message }]);
      await startMic(); // request mic up front (needs localhost/https)
      await speak(data.message);
    } catch {
      setStatus("idle");
    }
  }

  async function startMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setLines((p) => [...p, { role: "assistant", text: "The microphone needs a secure page — open the app at http://localhost:3000 (or serve it over HTTPS)." }]);
      throw new Error("insecure");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;
    source.connect(analyser);
    source.connect(proc);
    proc.connect(ctx.destination); // required for onaudioprocess to fire
    proc.onaudioprocess = (e) => {
      const frame = new Float32Array(e.inputBuffer.getChannelData(0));
      const pr = preRollRef.current;
      pr.push(frame);
      if (pr.length > PREROLL_FRAMES) pr.shift();
      if (capturingRef.current) bufRef.current.push(frame);
    };
    sessionRef.current = true;
    lastTsRef.current = performance.now();
    loop();
  }

  function loop() {
    const analyser = analyserRef.current;
    if (!analyser || !sessionRef.current) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);

    // Drive the mic button size directly (no re-render per frame).
    if (micBtnRef.current) {
      const scale = 1 + Math.min(1, rms * 6) * 0.55;
      micBtnRef.current.style.transform = `scale(${scale.toFixed(3)})`;
    }

    const now = performance.now();
    const dt = now - lastTsRef.current;
    lastTsRef.current = now;
    const st = statusRef.current;

    if (st === "speaking") {
      // barge-in: talk over the assistant to interrupt.
      if (rms > BARGE_IN) {
        ttsAudioRef.current?.pause();
        speakingRef.current = false;
        beginCapture();
      }
    } else if (st === "listening" || st === "capturing") {
      if (rms > SPEECH_ON) {
        if (!capturingRef.current) beginCapture();
        speechMsRef.current += dt;
        silenceStartRef.current = null;
      } else if (capturingRef.current) {
        // Anything at/below the threshold counts as silence — no gray zone.
        if (silenceStartRef.current == null) silenceStartRef.current = now;
        if (now - silenceStartRef.current > SILENCE_MS) {
          if (speechMsRef.current > MIN_SPEECH_MS) void endUtterance();
          else discardCapture();
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  function beginCapture() {
    capturingRef.current = true;
    bufRef.current = [...preRollRef.current]; // include the onset we already heard
    speechMsRef.current = 0;
    silenceStartRef.current = null;
    setStatus("capturing");
  }
  function discardCapture() {
    capturingRef.current = false;
    bufRef.current = [];
    silenceStartRef.current = null;
    if (sessionRef.current) setStatus("listening");
  }

  async function endUtterance() {
    capturingRef.current = false;
    setStatus("thinking");
    const chunks = bufRef.current;
    bufRef.current = [];
    silenceStartRef.current = null;
    const wavB64 = encodeWavB64(chunks, ctxRef.current?.sampleRate ?? 48000);
    try {
      const t = await (await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: wavB64, format: "wav" }) })).json();
      if (!t.text) {
        if (sessionRef.current) setStatus("listening");
        return;
      }
      setLines((p) => [...p, { role: "patient", text: t.text }]);
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: stateRef.current, userInput: t.text }) });
      const data = await r.json();
      stateRef.current = data.state;
      setForm(data.state.form);
      setLines((p) => [...p, { role: "assistant", text: data.message }]);
      if (data.confirmation) setConfirmation(data.confirmation);
      await speak(data.message);
    } catch {
      if (sessionRef.current) setStatus("listening");
    }
  }

  function teardownLive() {
    sessionRef.current = false;
    capturingRef.current = false;
    speakingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ttsAudioRef.current?.pause();
    procRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    procRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    if (micBtnRef.current) micBtnRef.current.style.transform = "scale(1)";
  }
  function stopLive() {
    teardownLive();
    setStatus("idle");
    setMode("idle");
  }

  /**
   * The mic button is an *input* control, not a hang-up:
   *  - while the assistant is asking → jump in and start answering (interrupt);
   *  - while it's hearing you → send what you've said now;
   *  - while idle-listening → start capturing.
   */
  function micAction() {
    const st = statusRef.current;
    if (st === "speaking") {
      ttsAudioRef.current?.pause();
      speakingRef.current = false;
      beginCapture();
    } else if (st === "capturing") {
      void endUtterance();
    } else if (st === "listening") {
      beginCapture();
    }
  }

  const demoDone = demoIdx >= steps.length - 1 && steps.length > 0 && !demoPlaying;

  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-muted)]">
          <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
          Voice intake · for US clinics
        </span>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">
          Patients book by <span className="text-[var(--color-accent)]">talking</span>.
          <br className="hidden sm:block" /> The form fills itself.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-[var(--color-muted)]">
          An AI assistant asks the same questions your front desk would — name, reason for the visit,
          date, insurance — and completes the intake in real time. Press play to watch a 30-second
          sample call, or just start talking.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={toggleDemo}
            disabled={steps.length === 0}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40"
          >
            {demoPlaying ? <><PauseIcon /> Pause demo</> : <><PlayIcon /> {demoDone ? "Replay demo" : "Play demo"}</>}
          </button>
          <button
            onClick={mode === "live" ? stopLive : startLive}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-white px-6 py-3 text-sm font-semibold transition hover:bg-slate-50"
          >
            <MicIcon /> {mode === "live" ? "End call" : "Talk to it yourself"}
          </button>
        </div>
      </section>

      <div className="grid gap-5 lg:h-[34rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <CallPanel
          mode={mode}
          lines={lines}
          transcriptRef={transcriptRef}
          liveStatus={liveStatus}
          micBtnRef={micBtnRef}
          onMic={micAction}
          onEnd={stopLive}
          demo={{ playing: demoPlaying, idx: demoIdx, total: steps.length, toggle: toggleDemo }}
        />
        <IntakeForm form={form} confirmation={confirmation} />
      </div>
    </div>
  );
}

const LIVE_LABEL: Record<LiveStatus, string> = {
  idle: "",
  connecting: "Connecting…",
  listening: "Listening — just speak",
  capturing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Asking… — jump in any time",
};
const MIC_ACTION: Record<LiveStatus, string> = {
  idle: "",
  connecting: "Connecting…",
  listening: "Tap to start answering",
  capturing: "Tap to send",
  thinking: "Working…",
  speaking: "Tap to answer now",
};

function CallPanel({
  mode,
  lines,
  transcriptRef,
  liveStatus,
  micBtnRef,
  onMic,
  onEnd,
  demo,
}: {
  mode: Mode;
  lines: Line[];
  transcriptRef: React.RefObject<HTMLDivElement | null>;
  liveStatus: LiveStatus;
  micBtnRef: React.RefObject<HTMLButtonElement | null>;
  onMic: () => void;
  onEnd: () => void;
  demo: { playing: boolean; idx: number; total: number; toggle: () => void };
}) {
  const live = mode === "live";
  const dot = mode === "idle" ? "bg-slate-300" : live ? "bg-red-500" : "bg-[var(--color-accent)]";
  const label = mode === "idle" ? "Not started" : live ? "On a call" : "Playing demo";
  const micColor =
    liveStatus === "capturing" ? "bg-red-500" : liveStatus === "thinking" ? "bg-amber-500" : liveStatus === "speaking" ? "bg-slate-400" : "bg-[var(--color-accent)]";

  return (
    <section className="flex h-[26rem] flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white shadow-sm lg:h-full">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-3.5">
        <span className={`size-2 rounded-full ${dot} ${mode !== "idle" ? "animate-pulse" : ""}`} />
        <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
      </div>

      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {lines.length === 0 ? (
          <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-center">
            <p className="text-sm font-medium">Watch a sample call, or talk to it yourself</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--color-muted)]">
              The conversation appears here and the intake form on the right fills in as it goes.
            </p>
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={l.role === "assistant" ? "" : "text-right"}>
              <span className={`msg-in inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${l.role === "assistant" ? "bg-slate-50 text-[var(--color-ink)] ring-1 ring-[var(--color-line)]" : "bg-[var(--color-accent)] text-white"}`}>
                {l.text}
              </span>
            </div>
          ))
        )}
      </div>

      {live && (
        <div className="flex items-center gap-4 border-t border-[var(--color-line)] px-5 py-5">
          <div className="grid size-14 place-items-center">
            <button
              ref={micBtnRef}
              onClick={onMic}
              style={{ transition: "transform 80ms linear, background-color 200ms" }}
              className={`grid size-12 place-items-center rounded-full text-white ${micColor} ${liveStatus === "listening" || liveStatus === "capturing" ? "mic-halo" : ""}`}
              aria-label={MIC_ACTION[liveStatus] || "Microphone"}
              title={MIC_ACTION[liveStatus]}
            >
              <MicIcon />
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{LIVE_LABEL[liveStatus] || "Listening…"}</p>
            <p className="text-xs text-[var(--color-muted)]">Always listening — answer whenever you're ready.</p>
          </div>
          <button onClick={onEnd} className="ml-auto shrink-0 text-xs font-medium text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline">
            End call
          </button>
        </div>
      )}
      {mode === "demo" && demo.total > 0 && (
        <div className="flex items-center gap-3 border-t border-[var(--color-line)] px-5 py-4">
          <button onClick={demo.toggle} className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-white transition hover:brightness-110">
            {demo.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="flex-1">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
              <div className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300" style={{ width: `${((demo.idx + 1) / demo.total) * 100}%` }} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const PlayIcon = () => <svg viewBox="0 0 24 24" className="size-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
const PauseIcon = () => <svg viewBox="0 0 24 24" className="size-4" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
const MicIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

/** Concatenate Float32 mic chunks, downsample to 16 kHz, encode 16-bit WAV → base64. */
function encodeWavB64(chunks: Float32Array[], inRate: number): string {
  let len = 0;
  for (const c of chunks) len += c.length;
  const merged = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  const outRate = 16000;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.floor(merged.length / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)] || 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outRate, true);
  view.setUint32(28, outRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++, off += 2) view.setInt16(off, pcm[i], true);
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
