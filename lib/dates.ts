import type { Cell } from "./types";

export type DateOrder = "dmy" | "mdy" | "ymd";

const MS_DAY = 86_400_000;

export function isMissing(v: Cell): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** ผลลัพธ์เป็นจำนวนวันตั้งแต่ epoch (UTC) หรือ null ถ้าอ่านไม่ได้ */
function toDay(y: number, m: number, d: number): number | null {
  if (!valid(y, m, d)) return null;
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function dayToIso(day: number): string {
  const dt = new Date(day * MS_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ISO_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})$/;
const PART_RE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?!\d)/;

/**
 * แปลงค่าเป็นวันที่ (จำนวนวันตั้งแต่ epoch) — ไม่เดา order เมื่อกำกวม:
 * - YYYY-MM-DD (ปีหน้า 4 หลัก) อ่านเป็น Y-M-D เสมอ ไม่ขึ้นกับ order
 * - รูปแบบอื่นอ่านตาม `order` ที่กำหนด แต่ถ้าค่าชัดเจนว่าสลับวัน/เดือน (เช่น 17/7/2026
 *   ใน mdy) จะอ่านให้ถูกต้องเอง
 */
export function parseDay(v: Cell, order: DateOrder = "dmy"): number | null {
  if (isMissing(v)) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // SheetJS ให้ Date ที่ local time ตรงกับค่าใน Excel (อาจเพี้ยนระดับวินาที) → ขยับ +12 ชม. แล้วอ่าน local
    const adj = new Date(v.getTime() + 12 * 3_600_000);
    return toDay(adj.getFullYear(), adj.getMonth() + 1, adj.getDate());
  }
  if (typeof v !== "string") return null;
  const s = v.trim();

  let m = ISO_RE.exec(s);
  if (m) return toDay(+m[1], +m[2], +m[3]);

  m = COMPACT_RE.exec(s);
  if (m) return toDay(+m[1], +m[2], +m[3]);

  m = PART_RE.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const c = +m[3];
    const fixYear = (y: number) => (y < 100 ? 2000 + y : y);
    let y: number, mo: number, d: number;
    if (order === "ymd") {
      y = fixYear(a);
      mo = b;
      d = c;
    } else if (order === "mdy") {
      mo = a;
      d = b;
      y = fixYear(c);
    } else {
      d = a;
      mo = b;
      y = fixYear(c);
    }
    let r = toDay(y, mo, d);
    if (r === null && order !== "ymd") r = toDay(y, d, mo); // ชัดเจนว่าสลับกัน (เช่น เดือน > 12)
    return r;
  }

  if (/[A-Za-z]{3}/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const dt = new Date(t);
      return toDay(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
  }
  return null;
}

export function formatDay(day: number | null): string | null {
  return day === null ? null : dayToIso(day);
}

/** แปลงเป็นตัวเลข — ตัดเครื่องหมาย , คั่นหลักพันเมื่อรูปแบบถูกต้อง */
export function toNumber(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return null;
  const s = v.trim();
  if (s === "") return null;
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return null;
}

/** ตัวอย่าง 20 ค่าแรกที่ไม่ว่าง ไว้เดาว่าคอลัมน์เป็นวันที่หรือไม่ */
export function isDateLike(values: Cell[], order: DateOrder = "dmy"): boolean {
  const sample: Cell[] = [];
  for (const v of values) {
    if (isMissing(v)) continue;
    sample.push(v);
    if (sample.length >= 20) break;
  }
  if (sample.length === 0) return false;
  if (sample.some((v) => v instanceof Date)) return true;
  if (sample.every((v) => toNumber(v) !== null)) return false;
  const ok = sample.filter((v) => parseDay(v, order) !== null).length;
  return ok / sample.length >= 0.5;
}
