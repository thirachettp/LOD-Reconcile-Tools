/// <reference lib="webworker" />
import { compareTables } from "./compare";
import { buildResultWorkbook } from "./export-xlsx";
import { buildStandard } from "./formulas";
import { dropFile, loadFile, readCombined, toCsv, type FileInfo, type SheetRequest } from "./io";
import { isMissing, toNumber } from "./dates";
import type {
  Cell,
  CompareOptions,
  CompareResult,
  CompareSummary,
  FieldMeta,
  MappingRow,
  RunInfo,
  Table,
} from "./types";

/** ข้อมูลทั้งหมดอยู่ใน worker — ฝั่ง UI ได้รับแค่ preview/สรุป เพื่อรองรับไฟล์ใหญ่ */
const state: {
  raw: { a: Table | null; b: Table | null };
  std: { a: Table | null; b: Table | null };
  result: CompareResult | null;
} = { raw: { a: null, b: null }, std: { a: null, b: null }, result: null };

export interface TableMeta {
  columns: string[];
  rowCount: number;
  preview: Cell[][];
}

const meta = (t: Table, n: number): TableMeta => ({
  columns: t.columns,
  rowCount: t.rows.length,
  preview: t.rows.slice(0, n),
});

export type StatusFilter = "All" | "Match" | "Mismatch" | "Missing A" | "Missing B";

export interface PageQuery {
  filter: StatusFilter;
  search: string;
  sortCol: string | null;
  sortDir: "asc" | "desc";
  offset: number;
  limit: number;
}

export interface CompareMeta {
  columns: string[];
  keys: string[];
  fields: FieldMeta[];
  statusCol: number;
  mismatchedCol: number;
  summary: CompareSummary;
  notes: string[];
  info: RunInfo | null;
}

function filteredRows(q: Omit<PageQuery, "offset" | "limit">): Cell[][] {
  const res = state.result;
  if (!res) return [];
  let rows = res.rows;
  if (q.filter !== "All") rows = rows.filter((r) => r[res.statusCol] === q.filter);
  const s = q.search.trim().toLowerCase();
  if (s) {
    rows = rows.filter((r) => {
      for (let i = 0; i < res.keys.length; i++) {
        if (String(r[i] ?? "").toLowerCase().includes(s)) return true;
      }
      return false;
    });
  }
  if (q.sortCol) {
    const idx = res.columns.indexOf(q.sortCol);
    if (idx >= 0) {
      const isDiff = q.sortCol.endsWith("_Diff");
      const dir = q.sortDir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = a[idx];
        const vb = b[idx];
        if (isDiff) {
          return (Math.abs(toNumber(va) ?? 0) - Math.abs(toNumber(vb) ?? 0)) * dir;
        }
        if (isMissing(va) && isMissing(vb)) return 0;
        if (isMissing(va)) return 1;
        if (isMissing(vb)) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
      });
    }
  }
  return rows;
}

const handlers = {
  async loadFile(p: { id: string; name: string; size: number; buf: ArrayBuffer }): Promise<FileInfo> {
    return loadFile(p.id, p.name, p.size, p.buf);
  },
  async dropFile(p: { id: string }) {
    dropFile(p.id);
  },
  async combine(p: { side: "a" | "b"; reqs: SheetRequest[] }) {
    const { table, errors } = readCombined(p.reqs);
    state.raw[p.side] = p.reqs.length ? table : null;
    state.std = { a: null, b: null };
    state.result = null;
    return { meta: p.reqs.length ? meta(table, 10) : null, errors };
  },
  async distinct(p: { side: "a" | "b"; column: string; limit: number }) {
    const t = state.raw[p.side];
    if (!t) return [] as string[];
    const idx = t.columns.indexOf(p.column);
    if (idx < 0) return [];
    const set = new Set<string>();
    for (const r of t.rows) {
      const v = r[idx];
      if (isMissing(v)) continue;
      set.add(String(v).trim());
      if (set.size > p.limit) return null;
    }
    return Array.from(set).sort();
  },
  async build(p: { rows: MappingRow[]; labelA: string; labelB: string }) {
    if (!state.raw.a || !state.raw.b) throw new Error("กรุณาอัปโหลดและรวมไฟล์ทั้งสองฝั่งก่อน");
    const a = buildStandard(state.raw.a, p.rows, "a", p.labelA);
    const b = buildStandard(state.raw.b, p.rows, "b", p.labelB);
    state.std = { a: a.table, b: b.table };
    state.result = null;
    return { a: meta(a.table, 50), b: meta(b.table, 50), warnings: [...a.warnings, ...b.warnings] };
  },
  async compare(p: { keys: string[]; fields: string[]; opts: CompareOptions; info: RunInfo }): Promise<CompareMeta> {
    if (!state.std.a || !state.std.b) throw new Error("กรุณา Build Standard Tables ก่อน");
    const res = compareTables(state.std.a, state.std.b, p.keys, p.fields, p.opts);
    res.info = p.info;
    state.result = res;
    return {
      columns: res.columns,
      keys: res.keys,
      fields: res.fields,
      statusCol: res.statusCol,
      mismatchedCol: res.mismatchedCol,
      summary: res.summary,
      notes: res.notes,
      info: res.info,
    };
  },
  async page(q: PageQuery) {
    const rows = filteredRows(q);
    return { total: rows.length, rows: rows.slice(q.offset, q.offset + q.limit) };
  },
  async exportXlsx(): Promise<ArrayBuffer> {
    if (!state.result) throw new Error("ยังไม่มีผล Compare");
    return buildResultWorkbook(state.result);
  },
  async exportCsv(q: Omit<PageQuery, "offset" | "limit">): Promise<string> {
    if (!state.result) throw new Error("ยังไม่มีผล Compare");
    return toCsv(state.result.columns, filteredRows(q));
  },
  async exportStd(p: { side: "a" | "b" }): Promise<string> {
    const t = state.std[p.side];
    if (!t) throw new Error("ยังไม่ได้ Build");
    return toCsv(t.columns, t.rows);
  },
  async exportRaw(p: { side: "a" | "b" }): Promise<string> {
    const t = state.raw[p.side];
    if (!t) throw new Error("ยังไม่มีข้อมูล");
    return toCsv(t.columns, t.rows);
  },
};

export type Handlers = typeof handlers;

self.onmessage = async (ev: MessageEvent<{ id: number; type: keyof Handlers; payload: never }>) => {
  const { id, type, payload } = ev.data;
  try {
    const fn = handlers[type] as (p: never) => Promise<unknown>;
    const result = await fn(payload);
    const transfer = result instanceof ArrayBuffer ? [result] : [];
    (self as unknown as Worker).postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
