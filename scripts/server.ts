/**
 * Phase 4 — minimal HTTP API. A thin Node server wrapping lib/api.ts handlers;
 * no framework, no database. Endpoints (all POST, JSON):
 *   /api/chat       { state?, userInput? } → { state, message, done, confirmation }
 *   /api/transcribe { audioBase64, format? } → { text }
 *   /api/speak      { text, voice? } → { audioBase64, format }
 *   /api/submit     { form } → { ok, confirmation | errors }
 *
 *   npm run server          (PORT=8787 by default)
 */
import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";
import { chatTurn, transcribeTurn, speakTurn, submitTurn, HttpError } from "../lib/api.ts";

const PORT = Number(process.env.PORT || 8787);

const routes: Record<string, (body: any) => unknown | Promise<unknown>> = {
  "/api/chat": chatTurn,
  "/api/transcribe": transcribeTurn,
  "/api/speak": speakTurn,
  "/api/submit": submitTurn,
};

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, "invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  const send = (status: number, obj: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  if (req.method === "GET" && req.url === "/") return send(200, { ok: true, service: "clinic-intake" });

  const handler = routes[req.url ?? ""];
  if (req.method !== "POST" || !handler) return send(404, { error: "not found" });

  try {
    send(200, await handler(await readBody(req)));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    send(status, { error: (err as Error).message });
  }
});

server.listen(PORT, () => console.log(`🩺 Clinic intake API on http://localhost:${PORT}`));
