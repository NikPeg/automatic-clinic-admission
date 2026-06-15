/**
 * Phase 4 smoke test: exercises all four endpoints against a running server
 * (start it with `npm run server` first), including multi-turn state threading
 * and a speak → transcribe round-trip.
 *
 *   npm run server          # terminal 1
 *   npm run verify:api      # terminal 2
 */
import "dotenv/config";

const BASE = `http://localhost:${process.env.PORT || 8787}`;

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log("→ /api/chat (greeting)");
  let chat = await post("/api/chat", {});
  console.log("   assistant:", chat.message);

  console.log("→ /api/chat (one turn: name)");
  chat = await post("/api/chat", { state: chat.state, userInput: "Nikita Petrov" });
  console.log("   assistant:", chat.message);

  console.log("→ /api/speak");
  const spoken = await post("/api/speak", { text: "Hello from the clinic." });
  console.log(`   got ${spoken.format}, ${spoken.audioBase64.length} base64 chars`);

  console.log("→ /api/transcribe (of the speak output)");
  const heard = await post("/api/transcribe", { audioBase64: spoken.audioBase64, format: "wav" });
  console.log("   transcript:", heard.text);

  console.log("→ /api/submit (valid form)");
  const sub = await post("/api/submit", {
    form: {
      fullName: "Jane Doe",
      reasonForVisit: "Headache",
      dob: "05/14/1990",
      mobilePhone: "(415) 555-0142",
      preferredDate: `12/31/${new Date().getFullYear() + 1}`,
      hasInsurance: false,
      patientType: "New",
    },
  });
  console.log("   submit:", JSON.stringify(sub));

  console.log("\n✅ all four endpoints responded");
}

main().catch((err) => {
  console.error("\n❌ verify-api failed: " + (err as Error).message);
  console.error("Is the server running?  npm run server");
  process.exit(1);
});
