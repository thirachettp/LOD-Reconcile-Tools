import {
  type DateOrder,
  formatDay,
  isDateLike,
  isMissing,
  parseDay,
  toNumber,
} from "./dates";
import type { Cell, MappingRow, SideCfg, SumifOperator, Table } from "./types";

const DATE_ORDER_FN: Record<string, DateOrder> = { "วดป": "dmy", "ปดว": "ymd", "ดวป": "mdy" };

export interface FormulaResult {
  values: Cell[];
  warnings: string[];
}

function colIndex(t: Table, name: string): number {
  return t.columns.indexOf(name);
}

function column(t: Table, idx: number): Cell[] {
  return t.rows.map((r) => r[idx]);
}

function norm(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function sumifMask(
  crit: Cell[],
  op: SumifOperator,
  other: Cell[] | string,
  columnMode: boolean,
  list: string[],
): boolean[] {
  const n = crit.length;
  const out = new Array<boolean>(n);
  const set = new Set(list.map((x) => x.trim()));
  for (let i = 0; i < n; i++) {
    const c = crit[i];
    const o = columnMode ? (other as Cell[])[i] : (other as string);
    switch (op) {
      case "is_blank":
        out[i] = isMissing(c);
        break;
      case "is_not_blank":
        out[i] = !isMissing(c);
        break;
      case "==":
        out[i] = norm(c) === norm(o);
        break;
      case "!=":
        out[i] = norm(c) !== norm(o);
        break;
      case ">":
      case "<":
      case ">=":
      case "<=": {
        const a = toNumber(c);
        const b = columnMode ? toNumber(o as Cell) : toNumber(String(o));
        if (a === null || b === null) out[i] = false;
        else if (op === ">") out[i] = a > b;
        else if (op === "<") out[i] = a < b;
        else if (op === ">=") out[i] = a >= b;
        else out[i] = a <= b;
        break;
      }
      case "contains":
        out[i] = norm(c).toLowerCase().includes(norm(o).toLowerCase());
        break;
      case "not_contains":
        out[i] = !norm(c).toLowerCase().includes(norm(o).toLowerCase());
        break;
      case "in_list":
        out[i] = set.has(norm(c));
        break;
      case "not_in_list":
        out[i] = !set.has(norm(c));
        break;
      default:
        out[i] = false;
    }
  }
  return out;
}

/** คำนวณ 1 สูตรกับตาราง (ต่อแถว) — พฤติกรรมตรงกับ apply_formula ของเวอร์ชัน Streamlit */
export function applyFormula(
  table: Table,
  cfg: SideCfg,
  label: string,
  dateOrder: DateOrder = "dmy",
): FormulaResult {
  const n = table.rows.length;
  const warnings: string[] = [];
  const nulls = (): Cell[] => new Array<Cell>(n).fill(null);

  const cols = cfg.columns
    .map((name) => ({ name, idx: colIndex(table, name) }))
    .filter((c) => c.idx >= 0);
  if (cols.length === 0) return { values: nulls(), warnings };

  const fn = cfg.function;

  // เลือกหลายคอลัมน์ = ใช้ค่าแรกที่ไม่ว่างของแต่ละแถว (เช่น ไฟล์รวมที่บางไฟล์ใช้ sku_id บางไฟล์ใช้ IBC)
  const coalesce = (): Cell[] => {
    const arrs = cols.map((c) => column(table, c.idx));
    const out = new Array<Cell>(n).fill(null);
    for (let i = 0; i < n; i++) {
      for (const a of arrs) {
        if (!isMissing(a[i])) {
          out[i] = a[i];
          break;
        }
      }
    }
    return out;
  };

  if (fn in DATE_ORDER_FN) {
    const vals = coalesce();
    return { values: vals.map((v) => formatDay(parseDay(v, DATE_ORDER_FN[fn]))), warnings };
  }

  if (fn === "FIRST") {
    const vals = coalesce();
    if (isDateLike(vals, dateOrder)) {
      return { values: vals.map((v) => formatDay(parseDay(v, dateOrder))), warnings };
    }
    return { values: vals.map((v) => (v instanceof Date ? v.toISOString() : v ?? null)), warnings };
  }

  if (fn === "SUM") {
    const out = new Array<Cell>(n).fill(0);
    for (const c of cols) {
      let bad = 0;
      for (let i = 0; i < n; i++) {
        const raw = table.rows[i][c.idx];
        const num = toNumber(raw);
        if (num === null) {
          if (!isMissing(raw)) bad++;
        } else {
          out[i] = (out[i] as number) + num;
        }
      }
      if (bad > 0) warnings.push(`${label} ← คอลัมน์ '${c.name}': ${bad} แถวไม่ใช่ตัวเลข ถูกนับเป็น 0`);
    }
    return { values: out, warnings };
  }

  if (fn === "SUMIF") {
    const sumCol = cols[0];
    const critIdx = cfg.criteria_column ? colIndex(table, cfg.criteria_column) : -1;
    if (!sumCol || critIdx < 0) return { values: nulls(), warnings };
    const op = cfg.operator ?? "==";
    const crit = column(table, critIdx);
    let other: Cell[] | string = cfg.criteria_value ?? "";
    let columnMode = false;
    if (cfg.criteria_mode === "column" && cfg.criteria_column2) {
      const i2 = colIndex(table, cfg.criteria_column2);
      if (i2 >= 0) {
        other = column(table, i2);
        columnMode = true;
      }
    }
    const mask = sumifMask(crit, op, other, columnMode, cfg.criteria_values ?? []);
    let bad = 0;
    const out = new Array<Cell>(n);
    for (let i = 0; i < n; i++) {
      const raw = table.rows[i][sumCol.idx];
      const num = toNumber(raw);
      if (num === null && !isMissing(raw)) bad++;
      out[i] = mask[i] && num !== null ? num : 0;
    }
    if (bad > 0) warnings.push(`${label} (SUMIF) ← คอลัมน์ '${sumCol.name}': ${bad} แถวไม่ใช่ตัวเลข ถูกนับเป็น 0`);
    return { values: out, warnings };
  }

  if (fn === "MIN" || fn === "MAX") {
    const colVals = cols.map((c) => column(table, c.idx));
    const asDate = colVals.some((v) => isDateLike(v, dateOrder));
    const out = new Array<Cell>(n).fill(null);
    for (let i = 0; i < n; i++) {
      let best: number | null = null;
      for (const cv of colVals) {
        const x = asDate ? parseDay(cv[i], dateOrder) : toNumber(cv[i]);
        if (x === null) continue;
        if (best === null || (fn === "MIN" ? x < best : x > best)) best = x;
      }
      out[i] = best === null ? null : asDate ? formatDay(best) : best;
    }
    return { values: out, warnings };
  }

  if (fn === "COUNT") {
    const out = new Array<Cell>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (const c of cols) if (!isMissing(table.rows[i][c.idx])) k++;
      out[i] = k;
    }
    return { values: out, warnings };
  }

  return { values: nulls(), warnings };
}

export interface StandardBuild {
  table: Table;
  warnings: string[];
}

/** สร้าง Standard Table ของ 1 ฝั่งจาก Mapping (side = "a" | "b") */
export function buildStandard(
  raw: Table,
  rows: MappingRow[],
  side: "a" | "b",
  sideLabel: string,
): StandardBuild {
  const active = rows.filter((r) => r.target.trim() !== "");
  const columns = active.map((r) => r.target.trim());
  const results = active.map((r) =>
    applyFormula(raw, r[side], `[${sideLabel}] Target '${r.target.trim()}'`),
  );
  const warnings = results.flatMap((r) => r.warnings);
  const n = raw.rows.length;
  const outRows: Cell[][] = new Array(n);
  for (let i = 0; i < n; i++) outRows[i] = results.map((r) => r.values[i]);
  return { table: { columns, rows: outRows }, warnings };
}
