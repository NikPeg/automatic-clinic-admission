/**
 * Local audio helpers for the headless voice scripts (macOS).
 *   - playWav: play audio through `afplay`.
 *   - Recorder: push-to-talk mic capture via `ffmpeg` (avfoundation).
 *
 * These are dev/CLI utilities; the browser frontend (Phase 6) uses Web APIs
 * instead.
 */
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

async function tmpFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clinic-"));
  return join(dir, name);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

/** Play WAV bytes through afplay (macOS). */
export async function playWav(wav: Buffer): Promise<void> {
  const f = await tmpFile("out.wav");
  await writeFile(f, wav);
  await run("afplay", [f]);
}

/**
 * Push-to-talk recorder using ffmpeg + avfoundation. `start()` begins capturing
 * the mic; `stop()` ends it and returns the recorded WAV bytes (16 kHz mono).
 * `micIndex` is the avfoundation audio device index (see `listInputsHint`).
 */
export class Recorder {
  private proc: ChildProcess | null = null;
  private file = "";
  private done: Promise<void> = Promise.resolve();
  private closed = false;

  /** `maxSeconds` hard-caps the clip (ffmpeg `-t`) so STT cost stays bounded. */
  constructor(private micIndex: string, private maxSeconds = 60) {}

  async start(): Promise<void> {
    this.file = await tmpFile("in.wav");
    this.closed = false;
    // ":<idx>" selects audio-only input in avfoundation; "-t" auto-stops.
    this.proc = spawn(
      "ffmpeg",
      ["-y", "-f", "avfoundation", "-i", `:${this.micIndex}`, "-ac", "1", "-ar", "16000", "-t", String(this.maxSeconds), this.file],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    this.done = new Promise<void>((resolve) => {
      this.proc!.on("close", () => {
        this.closed = true;
        resolve();
      });
    });
  }

  async stop(): Promise<Buffer> {
    if (!this.proc) throw new Error("Recorder not started");
    // If ffmpeg already hit the time cap it's closed; otherwise finalize with 'q'.
    if (!this.closed) {
      try {
        this.proc.stdin?.write("q");
        this.proc.stdin?.end();
      } catch {
        /* stdin may already be gone */
      }
    }
    await this.done;
    this.proc = null;
    return readFile(this.file);
  }
}

export const listInputsHint =
  'List mic devices with:  ffmpeg -f avfoundation -list_devices true -i ""\n' +
  "Then set MIC_INDEX to your microphone's index (default 0).";

/** Return ffmpeg's avfoundation device list (printed to stderr) for diagnostics. */
export function listAvfoundationDevices(): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", () => resolve(err));
    p.on("error", () => resolve("(ffmpeg not available)"));
  });
}

export type AudioDevice = { index: string; name: string };

/** Parse the avfoundation "audio devices" section into {index, name} entries. */
export async function audioInputDevices(): Promise<AudioDevice[]> {
  const out = await listAvfoundationDevices();
  const lines = out.split("\n");
  const start = lines.findIndex((l) => /audio devices:/i.test(l));
  if (start === -1) return [];
  const devices: AudioDevice[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (!m) break;
    devices.push({ index: m[1], name: m[2] });
  }
  return devices;
}

/**
 * Pick the real microphone, skipping virtual devices (Zoom, BlackHole, etc.).
 * Honors MIC_INDEX if set. Falls back to "0".
 */
export async function detectMicIndex(): Promise<{ index: string; name: string; all: AudioDevice[] }> {
  const all = await audioInputDevices();
  if (process.env.MIC_INDEX) {
    const found = all.find((d) => d.index === process.env.MIC_INDEX);
    return { index: process.env.MIC_INDEX, name: found?.name ?? "(unknown)", all };
  }
  const real =
    all.find((d) => /microphone|macbook|built-?in|airpods|headset/i.test(d.name)) ??
    all.find((d) => !/zoom|blackhole|loopback|aggregate|virtual/i.test(d.name)) ??
    all[0];
  return { index: real?.index ?? "0", name: real?.name ?? "(unknown)", all };
}
