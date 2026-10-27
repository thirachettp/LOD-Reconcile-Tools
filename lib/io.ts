import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Cell, Table } from "./types";

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  isExcel: boolean;
  sheets: (string | null)[]; // CSV = [null]
}

export interface SheetRequest {
  fileId: string;
  sheet: string | null;
  headerRow: number; // 1-indexed
}

const isExcelName = (n: string) => /\.(xlsx|xls|xlsm)$/i.test(n);

function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // ไฟล์ CSV ภาษาไทยจาก Excel เก่ามักเป็น TIS-620 / Windows-874
    return new TextDecoder("windows-874").decode(buf);
  }
}

type Parsed =
  | { kind: "csv"; rows: Cell[][] }
  | { kind: "xlsx"; wb: XLSX.WorkBook };

const cache = new Map<string, Parsed>();

export function loadFile(id: string, name: string, size: number, buf: ArrayBuffer): FileInfo {
  if (isExcelName(name)) {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellNF: true });
    cache.set(id, { kind: "xlsx", wb });
    return { id, name, size, isExcel: true, sheets: wb.SheetNames };
  }
  let text = decodeText(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  cache.set(id, { kind: "csv", rows: res.data as Cell[][] });
  return { id, name, size, isExcel: false, sheets: [null] };
}

export function dropFile(id: string) {
  cache.delete(id);
}

const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * แปลงเซลล์ Excel เป็นค่า — วันที่อ่านจากเลข serial + รูปแบบเซลล์โดยตรง (ไม่ผ่าน Date)
 * จึงไม่คลาดเคลื่อนตาม timezone ของเบราว์เซอร์ (SheetJS cellDates อาจถอยวัน/เพี้ยนเป็นนาทีได้)
 * ผลลัพธ์: "YYYY-MM-DD" หรือ "YYYY-MM-DD HH:mm[:ss]" ถ้ามีเวลา
 */
function cellValue(cell: XLSX.CellObject): Cell {
  switch (cell.t) {
    case "n": {
      const v = cell.v as number;
      if (typeof cell.z === "string" && XLSX.SSF.is_date(cell.z) && Number.isFinite(v)) {
        const d = XLSX.SSF.parse_date_code(v);
        if (d) {
          const time = d.S ? `${p2(d.H)}:${p2(d.M)}:${p2(Math.floor(d.S))}` : `${p2(d.H)}:${p2(d.M)}`;
          if (v >= 0 && v < 1) return time; // เซลล์เก็บเฉพาะเวลา
          const date = `${d.y}-${p2(d.m)}-${p2(d.d)}`;
          return d.H || d.M || d.S ? `${date} ${time}` : date;
        }
      }
      return v;
    }
    case "s":
      return (cell.v as string) ?? null;
    case "b":
      return cell.v as boolean;
    case "d":
      return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : null;
    default:
      return null; // error / stub
  }
}

/** อ่าน Sheet เป็นตารางสี่เหลี่ยมโดยเริ่มจากแถว/คอลัมน์แรกของชีต เพื่อให้เลขแถว Header ตรงกับที่เห็นใน Excel */
function sheetToMatrix(ws: XLSX.WorkSheet): Cell[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const width = range.e.c + 1;
  const out: Cell[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: Cell[] = new Array(width).fill(null);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell) row[c] = cellValue(cell);
    }
    out.push(row);
  }
  return out;
}

function matrixToTable(matrix: Cell[][], headerRow: number): Table {
  const hIdx = Math.max(headerRow - 1, 0);
  const header = matrix[hIdx] ?? [];
  const seen = new Map<string, number>();
  const columns: string[] = [];
  const width = Math.max(header.length, ...matrix.slice(hIdx + 1, hIdx + 200).map((r) => r.length), 0);
  for (let i = 0; i < width; i++) {
    const raw = header[i];
    let name = raw === null || raw === undefined || String(raw).trim() === "" ? `Unnamed: ${i}` : String(raw);
    const k = seen.get(name);
    if (k !== undefined) {
      seen.set(name, k + 1);
      name = `${name}.${k + 1}`;
    } else seen.set(name, 0);
    columns.push(name);
  }
  const rows: Cell[][] = [];
  for (let r = hIdx + 1; r < matrix.length; r++) {
    const src = matrix[r];
    if (!src || src.every((v) => v === null || v === undefined || v === "")) continue;
    const row: Cell[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) {
      const v = src[c];
      row[c] = v === undefined || v === "" ? null : v;
    }
    rows.push(row);
  }
  return { columns, rows };
}

export function readSheet(req: SheetRequest): Table {
  const p = cache.get(req.fileId);
  if (!p) throw new Error("ไม่พบไฟล์ในหน่วยความจำ — กรุณาอัปโหลดใหม่");
  if (p.kind === "csv") return matrixToTable(p.rows, req.headerRow);
  const ws = req.sheet ? p.wb.Sheets[req.sheet] : p.wb.Sheets[p.wb.SheetNames[0]];
  if (!ws) throw new Error(`ไม่พบ Sheet '${req.sheet}'`);
  return matrixToTable(sheetToMatrix(ws), req.headerRow);
}

/** รวมหลายตาราง (ต่างไฟล์/ต่าง Sheet) เป็นตารางเดียว — คอลัมน์ = union ตามลำดับที่เจอ */
export function concatTables(tables: Table[]): Table {
  const columns: string[] = [];
  const pos = new Map<string, number>();
  for (const t of tables) {
    for (const c of t.columns) {
      if (!pos.has(c)) {
        pos.set(c, columns.length);
        columns.push(c);
      }
    }
  }
  const rows: Cell[][] = [];
  for (const t of tables) {
    const map = t.columns.map((c) => pos.get(c)!);
    for (const r of t.rows) {
      const out: Cell[] = new Array(columns.length).fill(null);
      for (let i = 0; i < map.length; i++) out[map[i]] = r[i];
      rows.push(out);
    }
  }
  return { columns, rows };
}

export function readCombined(reqs: SheetRequest[]): { table: Table; errors: string[] } {
  const tables: Table[] = [];
  const errors: string[] = [];
  for (const r of reqs) {
    try {
      tables.push(readSheet(r));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { table: concatTables(tables), errors };
}

export function toCsv(columns: string[], rows: Cell[][]): string {
  const csv = Papa.unparse({
    fields: columns,
    data: rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? ""))),
  });
  return "﻿" + csv; // BOM ให้ Excel เปิดภาษาไทยถูก
}
