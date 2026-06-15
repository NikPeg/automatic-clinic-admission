import { submitTurn, HttpError } from "@/lib/api.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(submitTurn(body));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
