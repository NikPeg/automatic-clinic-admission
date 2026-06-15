/**
 * Render the compiled intake graph so you can verify its structure visually.
 * Prints Mermaid (paste into https://mermaid.live or view in any Markdown
 * preview) and tries to write graph.png via mermaid.ink (needs network).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { buildGraph } from "../lib/agent/graph.ts";

async function main() {
  const app = buildGraph();
  const drawable =
    typeof (app as any).getGraphAsync === "function"
      ? await (app as any).getGraphAsync()
      : (app as any).getGraph();

  await mkdir(".artifacts", { recursive: true });
  const mermaid: string = drawable.drawMermaid();
  console.log(mermaid);
  await writeFile(".artifacts/graph.mmd", mermaid);
  console.log("→ wrote .artifacts/graph.mmd");

  try {
    const blob = await drawable.drawMermaidPng();
    const buf = Buffer.from(await blob.arrayBuffer());
    await writeFile(".artifacts/graph.png", buf);
    console.log(`→ wrote .artifacts/graph.png (${buf.length} bytes)`);
  } catch (err) {
    console.warn(
      "PNG render skipped (needs network to mermaid.ink): " + (err as Error).message,
    );
  }
}

main().catch((err) => {
  console.error("draw-graph failed: " + (err as Error).message);
  process.exit(1);
});
