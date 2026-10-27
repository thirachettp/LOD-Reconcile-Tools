export type Cell = string | number | boolean | Date | null | undefined;

/** ตารางแบบ column-oriented metadata + row arrays (ประหยัด memory กว่า object ต่อแถว) */
export interface Table {
  columns: string[];
  rows: Cell[][];
}

/**
 * ชื่อ Function — ใช้รหัสภาษาไทยของ 3 ตัวท้ายเหมือนเวอร์ชัน Streamlit
 * เพื่อให้ไฟล์ Mapping JSON เก่าใช้ได้
 */
export type FnName =
  | "FIRST"
  | "SUM"
  | "SUMIF"
  | "MIN"
  | "MAX"
  | "COUNT"
  | "วดป" // Day-Month-Year
  | "ปดว" // Year-Month-Day
  | "ดวป"; // Month-Day-Year

export const FUNCTIONS: FnName[] = [
  "FIRST",
  "SUM",
  "SUMIF",
  "MIN",
  "MAX",
  "COUNT",
  "วดป",
  "ปดว",
  "ดวป",
];

export const FUNCTION_HINTS: Record<FnName, string> = {
  FIRST: "ใช้ค่าจากคอลัมน์แรกที่เลือก",
  SUM: "รวมค่าตัวเลขของคอลัมน์ที่เลือก (ต่อแถว)",
  SUMIF: "รวมค่าเฉพาะแถวที่เข้าเงื่อนไข",
  MIN: "ค่าน้อยที่สุด / วันที่เก่าที่สุด",
  MAX: "ค่ามากที่สุด / วันที่ใหม่ที่สุด",
  COUNT: "นับจำนวนช่องที่ไม่ว่าง",
  "วดป": "อ่านเป็นวันที่แบบ วัน/เดือน/ปี (D/M/Y)",
  "ปดว": "อ่านเป็นวันที่แบบ ปี/เดือน/วัน (Y/M/D)",
  "ดวป": "อ่านเป็นวันที่แบบ เดือน/วัน/ปี (M/D/Y)",
};

export type SumifOperator =
  | "=="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "contains"
  | "not_contains"
  | "in_list"
  | "not_in_list"
  | "is_blank"
  | "is_not_blank";

export const SUMIF_OPERATORS: { code: SumifOperator; label: string }[] = [
  { code: "==", label: "=" },
  { code: "!=", label: "≠" },
  { code: ">", label: ">" },
  { code: "<", label: "<" },
  { code: ">=", label: "≥" },
  { code: "<=", label: "≤" },
  { code: "contains", label: "มีคำว่า..." },
  { code: "not_contains", label: "ไม่มีคำว่า..." },
  { code: "in_list", label: "อยู่ในกลุ่ม (IN)" },
  { code: "not_in_list", label: "ไม่อยู่ในกลุ่ม (NOT IN)" },
  { code: "is_blank", label: "ว่าง (blank)" },
  { code: "is_not_blank", label: "ไม่ว่าง (not blank)" },
];

/** ตั้งค่าสูตรของ 1 ฝั่ง (ชื่อ field เป็น snake_case เพื่อ compat กับ JSON ของ Streamlit) */
export interface SideCfg {
  function: FnName;
  columns: string[];
  criteria_column?: string | null;
  operator?: SumifOperator;
  criteria_mode?: "const" | "column";
  criteria_value?: string;
  criteria_column2?: string | null;
  criteria_values?: string[];
}

export interface MappingRow {
  id: string;
  target: string;
  a: SideCfg;
  b: SideCfg;
}

export type SystemCode = "FC" | "JDA" | "MHT" | "OTHER";
export const SYSTEMS: SystemCode[] = ["FC", "JDA", "MHT", "OTHER"];
export const SYSTEM_LABELS: Record<SystemCode, string> = {
  FC: "FC",
  JDA: "JDA",
  MHT: "MHT",
  OTHER: "อื่น ๆ",
};

export type Status = "Match" | "Mismatch" | "Missing A" | "Missing B";

export interface FieldMeta {
  name: string;
  isDate: boolean;
  colA: string;
  colB: string;
  colDiff: string;
}

export interface CompareSummary {
  total: number;
  match: number;
  mismatch: number;
  missingA: number;
  missingB: number;
  /** key ซ้ำที่ถูกรวมยอด (จำนวนแถวที่เกินมา) */
  duplicateKeysA: number;
  duplicateKeysB: number;
  perField: { name: string; isDate: boolean; totalAbsDiff: number; rowsDiff: number }[];
}

export interface CompareResult {
  columns: string[];
  rows: Cell[][];
  keys: string[];
  fields: FieldMeta[];
  statusCol: number;
  mismatchedCol: number;
  summary: CompareSummary;
  notes: string[];
}

export interface CompareOptions {
  fuzzyKeys: boolean;
  /** ความต่างตัวเลขที่ยอมรับได้ (|diff| <= tolerance ถือว่าตรง) */
  tolerance: number;
  tagA: string;
  tagB: string;
}
