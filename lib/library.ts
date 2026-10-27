import type { MappingRow, SideCfg, SystemCode } from "./types";

/**
 * คลัง Mapping ที่ตั้งชื่อและบันทึกไว้บนเว็บ (localStorage ของเบราว์เซอร์)
 * - เก็บเฉพาะสูตร (ไม่เก็บข้อมูลในไฟล์) พร้อม Key / Compare Fields ที่เลือกไว้
 * - ผูกกับเบราว์เซอร์/เครื่องที่ใช้ — ถ้าต้องการแชร์ข้ามคน/เครื่อง ใช้ Export JSON หรือเพิ่ม backend ภายหลัง
 */
export interface SavedMapping {
  id: string;
  name: string;
  sysA: SystemCode;
  sysB: SystemCode;
  rows: MappingRow[];
  compareKeys?: string[];
  compareFields?: string[];
  updatedAt: number;
  builtin?: boolean;
}

export class NameTakenError extends Error {
  existingId: string;
  constructor(name: string, existingId: string) {
    super(`ชื่อ “${name}” ถูกใช้แล้ว`);
    this.name = "NameTakenError";
    this.existingId = existingId;
  }
}

const KEY = "lod-reconcile:library:v1";
type Store = Pick<Storage, "getItem" | "setItem">;

function resolveStore(st?: Store): Store | null {
  if (st) return st;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

let seq = 0;
export function newId(): string {
  return `m${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** สำเนา rows พร้อม id ใหม่ (กัน id ชนกับ widget เดิม) */
export function cloneRows(rows: MappingRow[]): MappingRow[] {
  return (JSON.parse(JSON.stringify(rows)) as MappingRow[]).map((r) => ({ ...r, id: newId() }));
}

function isValid(x: unknown): x is SavedMapping {
  const m = x as SavedMapping;
  return !!m && typeof m.id === "string" && typeof m.name === "string" && Array.isArray(m.rows);
}

export function listSaved(st?: Store): SavedMapping[] {
  try {
    const s = resolveStore(st);
    const raw = s?.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValid) : [];
  } catch {
    return [];
  }
}

function write(list: SavedMapping[], st?: Store) {
  const s = resolveStore(st);
  if (!s) throw new Error("เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล (storage ถูกปิด เช่น โหมดส่วนตัว)");
  try {
    s.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("บันทึกไม่สำเร็จ (พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็มหรือถูกปิด)");
  }
}

export interface SaveInput {
  /** ถ้าระบุ = บันทึกทับรายการนี้ (และเปลี่ยนชื่อได้) */
  id?: string;
  name: string;
  sysA: SystemCode;
  sysB: SystemCode;
  rows: MappingRow[];
  compareKeys?: string[];
  compareFields?: string[];
  /** อนุญาตให้บันทึกทับรายการอื่นที่ชื่อซ้ำ */
  overwrite?: boolean;
}

function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("กรุณาตั้งชื่อ Mapping");
  if (name.length > 80) throw new Error("ชื่อยาวเกิน 80 ตัวอักษร");
  if (BUILTIN_MAPPINGS.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`ชื่อ “${name}” ตรงกับตัวอย่างในระบบ — กรุณาใช้ชื่ออื่น`);
  }
  return name;
}

export function saveMapping(input: SaveInput, st?: Store): SavedMapping {
  const name = checkName(input.name);
  const list = listSaved(st);
  const sameName = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  let targetId = input.id;
  if (sameName && sameName.id !== input.id) {
    if (!input.overwrite) throw new NameTakenError(name, sameName.id);
    targetId = sameName.id;
  }
  const item: SavedMapping = {
    id: targetId ?? newId(),
    name,
    sysA: input.sysA,
    sysB: input.sysB,
    rows: JSON.parse(JSON.stringify(input.rows)),
    compareKeys: input.compareKeys?.length ? [...input.compareKeys] : undefined,
    compareFields: input.compareFields?.length ? [...input.compareFields] : undefined,
    updatedAt: Date.now(),
  };
  const next = list.filter((x) => x.id !== item.id && !(input.overwrite && x.id === sameName?.id));
  next.push(item);
  next.sort((x, y) => y.updatedAt - x.updatedAt);
  write(next, st);
  return item;
}

export function renameMapping(id: string, rawName: string, st?: Store): SavedMapping {
  const name = checkName(rawName);
  const list = listSaved(st);
  const item = list.find((x) => x.id === id);
  if (!item) throw new Error("ไม่พบ Mapping นี้ (อาจถูกลบไปแล้ว)");
  const clash = list.find((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new NameTakenError(name, clash.id);
  item.name = name;
  item.updatedAt = Date.now();
  write(list, st);
  return item;
}

export function deleteMapping(id: string, st?: Store): void {
  write(listSaved(st).filter((x) => x.id !== id), st);
}

// ───────────── ตัวอย่างในระบบ (แก้ไม่ได้ แต่โหลดแล้วบันทึกเป็นชื่อของตัวเองได้) ─────────────

const row = (id: string, target: string, a: SideCfg, b: SideCfg): MappingRow => ({ id, target, a, b });

/**
 * FC vs Initialstock — มาจากไฟล์ Mapping_FC_OTHER.json ที่ผู้ใช้ส่งมา
 * (ตัดชื่อคอลัมน์ที่มี \n ท้ายออก — ระบบจับคู่กับหัวตารางจริงแบบไม่สนช่องว่าง/ขึ้นบรรทัดท้ายอยู่แล้ว)
 * หมายเหตุ: ต้นฉบับ LPN ฝั่ง FC มีคอลัมน์ exp_date นำหน้า "LPN No." ซึ่งน่าจะเป็นความผิดพลาด จึงตัดออก
 */
export const BUILTIN_MAPPINGS: SavedMapping[] = [
  {
    id: "builtin:fc-initialstock",
    name: "FC vs Initialstock",
    sysA: "FC",
    sysB: "OTHER",
    builtin: true,
    updatedAt: 0,
    rows: [
      row("bi1", "SKU", { function: "FIRST", columns: ["sku_id", "IBC"] }, { function: "FIRST", columns: ["ITEM_NO"] }),
      row("bi2", "Location", { function: "FIRST", columns: ["location_id", "Location ID"] }, { function: "FIRST", columns: ["Location_Id"] }),
      row("bi3", "LPN", { function: "FIRST", columns: ["LPN No."] }, { function: "FIRST", columns: ["LPN_NO"] }),
      row("bi4", "Lock Code", { function: "FIRST", columns: ["Lock Code"] }, { function: "FIRST", columns: ["Lockcode"] }),
      row("bi5", "Qty_total", { function: "SUM", columns: ["Stock on Hand"] }, { function: "SUM", columns: ["Qty"] }),
      row("bi6", "Receiving date", { function: "FIRST", columns: ["Receiving date"] }, { function: "FIRST", columns: ["GR_Date"] }),
    ],
  },
];
