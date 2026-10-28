import { createHash, timingSafeEqual } from "node:crypto";
import { BUILTIN_MAPPINGS, type SavedMapping } from "../library";
import { FUNCTIONS, SYSTEMS, type MappingRow, type SystemCode } from "../types";

/** ที่เก็บ Template ของทีม (Redis REST บน Vercel / ไฟล์ตอนทดสอบในเครื่อง) */
export interface TemplateStore {
  all(): Promise<SavedMapping[]>;
  put(item: SavedMapping): Promise<void>;
  del(id: string): Promise<void>;
}

export interface TplReq {
  method: string;
  id?: string | null;
  passcode?: string | null;
  body?: unknown;
}
export interface TplRes {
  status: number;
  json: unknown;
}

const MAX_ROWS = 100;
const MAX_NAME = 80;
const err = (status: number, error: string, message: string, extra?: object): TplRes => ({ status, json: { error, message, ...extra } });

const digest = (s: string) => createHash("sha256").update(s).digest();
export function passcodeOk(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new Error("กรุณาตั้งชื่อ Template");
  if (name.length > MAX_NAME) throw new Error(`ชื่อยาวเกิน ${MAX_NAME} ตัวอักษร`);
  if (BUILTIN_MAPPINGS.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`ชื่อ “${name}” ตรงกับตัวอย่างในระบบ — กรุณาใช้ชื่ออื่น`);
  }
  return name;
}

const strList = (x: unknown, max = 60): string[] | undefined => {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter((v): v is string => typeof v === "string" && v.length <= 200).slice(0, max);
  return out.length ? out : undefined;
};

function cleanCfg(c: unknown): MappingRow["a"] {
  const o = c as Record<string, unknown>;
  if (!o || typeof o !== "object" || !(FUNCTIONS as readonly string[]).includes(o.function as string)) throw new Error("สูตรไม่ถูกต้อง");
  const cols = strList(o.columns, 30) ?? [];
  const out: MappingRow["a"] = { function: o.function as MappingRow["a"]["function"], columns: cols };
  for (const k of ["criteria_column", "criteria_column2"] as const) if (typeof o[k] === "string") out[k] = (o[k] as string).slice(0, 200);
  if (typeof o.operator === "string") out.operator = o.operator as MappingRow["a"]["operator"];
  if (o.criteria_mode === "const" || o.criteria_mode === "column") out.criteria_mode = o.criteria_mode;
  if (typeof o.criteria_value === "string") out.criteria_value = o.criteria_value.slice(0, 500);
  const vals = strList(o.criteria_values, 500);
  if (vals) out.criteria_values = vals;
  return out;
}

function cleanRows(x: unknown): MappingRow[] {
  if (!Array.isArray(x) || x.length === 0) throw new Error("Template ต้องมีอย่างน้อย 1 แถวสูตร");
  if (x.length > MAX_ROWS) throw new Error(`สูตรมากเกิน ${MAX_ROWS} แถว`);
  return x.map((r, i) => {
    const o = r as Record<string, unknown>;
    return {
      id: typeof o?.id === "string" ? o.id.slice(0, 40) : `r${i}`,
      target: typeof o?.target === "string" ? o.target.slice(0, 120) : "",
      a: cleanCfg(o?.a),
      b: cleanCfg(o?.b),
    };
  });
}

const sys = (x: unknown): SystemCode => ((SYSTEMS as readonly string[]).includes(x as string) ? (x as SystemCode) : "OTHER");
const newTeamId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** ตรรกะของ API ทั้งหมด (ไม่ผูกกับ Next) เพื่อทดสอบได้ */
export async function handleTemplates(req: TplReq, store: TemplateStore | null, passcode: string | undefined): Promise<TplRes> {
  if (!store) return err(503, "not_configured", "ยังไม่ได้ตั้งค่าที่เก็บข้อมูลของทีม");
  if (!passcode) return err(503, "passcode_not_set", "ยังไม่ได้ตั้งรหัสผ่านของทีม (TEAM_PASSCODE)");
  if (!passcodeOk(req.passcode, passcode)) return err(401, "locked", req.passcode ? "รหัสผ่านไม่ถูกต้อง" : "ต้องใส่รหัสผ่านของทีม");

  try {
    const list = await store.all();
    const byName = (name: string) => list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const body = (req.body ?? {}) as Record<string, unknown>;
    const author = typeof body.author === "string" ? body.author.trim().slice(0, 40) || undefined : undefined;

    if (req.method === "GET") {
      return { status: 200, json: { items: [...list].sort((x, y) => y.updatedAt - x.updatedAt) } };
    }

    if (req.method === "PUT") {
      const name = cleanName(body.name);
      const id = typeof body.id === "string" && body.id ? body.id : undefined;
      const existing = id ? list.find((x) => x.id === id) : undefined;
      if (id && !existing) return err(404, "gone", "ไม่พบ Template นี้แล้ว (อาจถูกลบไปแล้ว) — บันทึกเป็นชื่อใหม่แทน");
      if (existing && typeof body.expectedUpdatedAt === "number" && existing.updatedAt !== body.expectedUpdatedAt) {
        return err(409, "conflict", `มีคนอื่นแก้ไข “${existing.name}” ไปแล้ว${existing.updatedBy ? ` (โดย ${existing.updatedBy})` : ""} — โหลดใหม่ก่อน หรือบันทึกเป็นชื่อใหม่`, { existingId: existing.id });
      }
      const clash = byName(name);
      let targetId = existing?.id;
      if (clash && clash.id !== existing?.id) {
        if (body.overwrite !== true) return err(409, "name_taken", `ชื่อ “${name}” ถูกใช้แล้ว`, { existingId: clash.id });
        targetId = clash.id;
        if (existing) await store.del(existing.id);
      }
      const prev = list.find((x) => x.id === targetId);
      const item: SavedMapping = {
        id: targetId ?? newTeamId(),
        name,
        sysA: sys(body.sysA),
        sysB: sys(body.sysB),
        rows: cleanRows(body.rows),
        compareKeys: strList(body.compareKeys),
        compareFields: strList(body.compareFields),
        updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1),
        updatedBy: author,
      };
      await store.put(item);
      return { status: 200, json: { item } };
    }

    if (req.method === "PATCH") {
      const id = typeof body.id === "string" ? body.id : "";
      const item = list.find((x) => x.id === id);
      if (!item) return err(404, "gone", "ไม่พบ Template นี้แล้ว");
      const name = cleanName(body.name);
      const clash = byName(name);
      if (clash && clash.id !== id) return err(409, "name_taken", `ชื่อ “${name}” ถูกใช้แล้ว`, { existingId: clash.id });
      if (typeof body.expectedUpdatedAt === "number" && item.updatedAt !== body.expectedUpdatedAt) {
        return err(409, "conflict", "มีคนอื่นแก้ไข Template นี้ไปแล้ว — โหลดใหม่ก่อน");
      }
      const next = { ...item, name, updatedAt: Math.max(Date.now(), item.updatedAt + 1), updatedBy: author ?? item.updatedBy };
      await store.put(next);
      return { status: 200, json: { item: next } };
    }

    if (req.method === "DELETE") {
      if (!req.id) return err(400, "bad_request", "ไม่ระบุ id");
      await store.del(req.id);
      return { status: 200, json: { ok: true } };
    }

    return err(405, "method", "ไม่รองรับคำสั่งนี้");
  } catch (e) {
    return err(400, "bad_request", e instanceof Error ? e.message : String(e));
  }
}
