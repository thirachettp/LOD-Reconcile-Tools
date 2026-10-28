import { getStore } from "@/lib/server/store";
import { handleTemplates } from "@/lib/server/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 400_000;

async function run(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let body: unknown;
  if (req.method === "PUT" || req.method === "PATCH") {
    const text = await req.text();
    if (text.length > MAX_BODY) return Response.json({ error: "too_large", message: "ข้อมูลใหญ่เกินไป" }, { status: 413 });
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "bad_request", message: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
  }
  const passcode = req.headers.get("x-team-passcode");
  const expected = process.env.TEAM_PASSCODE;
  const res = await handleTemplates({ method: req.method, id: url.searchParams.get("id"), passcode, body }, getStore(), expected);
  // หน่วงเล็กน้อยเมื่อรหัสผิด กันการเดารหัส
  if (res.status === 401 && passcode) await new Promise((r) => setTimeout(r, 600));
  return Response.json(res.json, { status: res.status, headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
