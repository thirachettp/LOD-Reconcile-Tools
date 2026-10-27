import { dayToIso, formatDay, isDateLike, isMissing, parseDay, toNumber } from "./dates";
import type {
  Cell,
  CompareOptions,
  CompareResult,
  CompareSummary,
  FieldKind,
  FieldMeta,
  Status,
  Table,
} from "./types";

interface Group {
  keyDisplay: Cell[];
  nums: (number | null)[];
  days: (number | null)[];
  texts: (string | null)[];
}

const SEP = "\u0001";

function normKey(v: Cell, isDate: boolean, fuzzy: boolean): string {
  if (isDate) {
    const d = parseDay(v, "dmy");
    return d === null ? "" : dayToIso(d);
  }
  if (isMissing(v)) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && !fuzzy) return v; // เทียบตรงตามที่ได้รับ ไม่ trim
  if (fuzzy) s = s.trim().toLowerCase();
  return s;
}

function colValues(t: Table, idx: number): Cell[] {
  return idx < 0 ? [] : t.rows.map((r) => r[idx]);
}

/** ชนิดของฟิลด์ตัดสินจากข้อมูลสองฝั่งรวมกัน: วันที่ / ตัวเลข / ข้อความ */
function detectKind(vals: Cell[]): FieldKind {
  if (isDateLike(vals)) return "date";
  let present = 0;
  let numeric = 0;
  for (const v of vals) {
    if (isMissing(v)) continue;
    present++;
    if (toNumber(v) !== null) numeric++;
  }
  if (present === 0) return "number";
  return numeric / present >= 0.8 ? "number" : "text";
}

interface Aggregated {
  map: Map<string, Group>;
  duplicates: number;
}

function aggregate(
  t: Table,
  keyIdx: number[],
  keyIsDate: boolean[],
  fieldIdx: number[],
  kinds: FieldKind[],
  fuzzy: boolean,
): Aggregated {
  const map = new Map<string, Group>();
  let dup = 0;
  for (const row of t.rows) {
    const parts = keyIdx.map((ix, k) => normKey(ix < 0 ? null : row[ix], keyIsDate[k], fuzzy));
    const key = parts.join(SEP);
    let g = map.get(key);
    if (!g) {
      g = {
        keyDisplay: keyIdx.map((ix, k) => {
          const v = ix < 0 ? null : row[ix];
          if (keyIsDate[k]) return formatDay(parseDay(v, "dmy"));
          if (fuzzy && typeof v === "string") return v.trim();
          return v instanceof Date ? v.toISOString() : v ?? null;
        }),
        nums: fieldIdx.map(() => null),
        days: fieldIdx.map(() => null),
        texts: fieldIdx.map(() => null),
      };
      map.set(key, g);
    } else {
      dup++;
    }
    fieldIdx.forEach((ix, f) => {
      const v = ix < 0 ? null : row[ix];
      if (kinds[f] === "date") {
        const d = parseDay(v, "dmy");
        if (d !== null && (g!.days[f] === null || d < (g!.days[f] as number))) g!.days[f] = d;
      } else if (kinds[f] === "text") {
        if (g!.texts[f] === null && !isMissing(v)) g!.texts[f] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      } else {
        const n = toNumber(v);
        if (n !== null) g!.nums[f] = (g!.nums[f] ?? 0) + n;
      }
    });
  }
  return { map, duplicates: dup };
}

function roundDiff(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function compareTables(
  stdA: Table,
  stdB: Table,
  keys: string[],
  fieldNames: string[],
  opts: CompareOptions,
): CompareResult {
  const notes: string[] = [];
  const common = keys.filter((k) => stdA.columns.includes(k) && stdB.columns.includes(k));
  if (common.length === 0) {
    throw new Error("ไม่พบ Key Columns ร่วมกันใน Standard Table ทั้งสองฝั่ง");
  }
  const dropped = keys.filter((k) => !common.includes(k));
  if (dropped.length) notes.push(`ข้าม Key ที่ไม่มีทั้งสองฝั่ง: ${dropped.join(", ")}`);

  const kA = common.map((k) => stdA.columns.indexOf(k));
  const kB = common.map((k) => stdB.columns.indexOf(k));
  const fields = fieldNames.filter((f) => stdA.columns.includes(f) && stdB.columns.includes(f));
  const fA = fields.map((f) => stdA.columns.indexOf(f));
  const fB = fields.map((f) => stdB.columns.indexOf(f));

  const kinds = fields.map((_, i) => detectKind([...colValues(stdA, fA[i]), ...colValues(stdB, fB[i])]));
  const keyIsDate = common.map((_, i) =>
    isDateLike([...colValues(stdA, kA[i]), ...colValues(stdB, kB[i])]),
  );

  const A = aggregate(stdA, kA, keyIsDate, fA, kinds, opts.fuzzyKeys);
  const B = aggregate(stdB, kB, keyIsDate, fB, kinds, opts.fuzzyKeys);
  if (A.duplicates > 0) notes.push(`ฝั่ง A มี Key ซ้ำ ${A.duplicates.toLocaleString()} แถว — ถูกรวมยอดเข้าด้วยกัน`);
  if (B.duplicates > 0) notes.push(`ฝั่ง B มี Key ซ้ำ ${B.duplicates.toLocaleString()} แถว — ถูกรวมยอดเข้าด้วยกัน`);
  const textFields = fields.filter((_, i) => kinds[i] === "text");
  if (textFields.length) {
    notes.push(`ฟิลด์ข้อความ (${textFields.join(", ")}) เทียบแบบตรงตัวอักษร ใช้ค่าแรกที่ไม่ว่างของ Key นั้น`);
  }

  const allKeys = Array.from(new Set([...A.map.keys(), ...B.map.keys()])).sort((x, y) =>
    x.localeCompare(y, undefined, { numeric: true }),
  );

  const meta: FieldMeta[] = fields.map((f, i) => ({
    name: f,
    kind: kinds[i],
    isDate: kinds[i] === "date",
    colA: `${f}_${opts.tagA}`,
    colB: `${f}_${opts.tagB}`,
    colDiff: kinds[i] === "text" ? null : `${f}_Diff`,
  }));

  const columns: string[] = [...common];
  for (const m of meta) {
    columns.push(m.colA, m.colB);
    if (m.colDiff) columns.push(m.colDiff);
  }
  columns.push("Status", "Mismatched Fields");
  const statusCol = columns.length - 2;
  const mismatchedCol = columns.length - 1;

  const rows: Cell[][] = new Array(allKeys.length);
  const summary: CompareSummary = {
    total: allKeys.length,
    match: 0,
    mismatch: 0,
    missingA: 0,
    missingB: 0,
    duplicateKeysA: A.duplicates,
    duplicateKeysB: B.duplicates,
    rowsA: stdA.rows.length,
    rowsB: stdB.rows.length,
    keysA: A.map.size,
    keysB: B.map.size,
    perField: meta.map((m) => ({
      name: m.name,
      isDate: m.isDate,
      kind: m.kind,
      totalAbsDiff: 0,
      rowsDiff: 0,
      sumA: m.kind === "number" ? 0 : null,
      sumB: m.kind === "number" ? 0 : null,
    })),
  };

  const tol = Math.abs(opts.tolerance || 0);
  const normText = (s: string | null) => {
    if (s === null) return "";
    const t = s.trim();
    return opts.fuzzyKeys ? t.toLowerCase() : t;
  };

  allKeys.forEach((key, r) => {
    const ga = A.map.get(key);
    const gb = B.map.get(key);
    const row: Cell[] = [...(ga ?? gb)!.keyDisplay];
    const mismatched: string[] = [];

    meta.forEach((m, i) => {
      if (m.kind === "text") {
        const ta = ga ? ga.texts[i] : null;
        const tb = gb ? gb.texts[i] : null;
        row.push(ta, tb);
        if (ga && gb && normText(ta) !== normText(tb)) {
          mismatched.push(m.name);
          summary.perField[i].rowsDiff++;
        }
        return;
      }

      let va: Cell = null;
      let vb: Cell = null;
      let diff: number | null = null;
      let bad = false;
      if (m.kind === "date") {
        const da = ga ? ga.days[i] : null;
        const db = gb ? gb.days[i] : null;
        va = formatDay(da);
        vb = formatDay(db);
        if (da !== null && db !== null) {
          diff = da - db;
          bad = diff !== 0;
        } else {
          bad = da !== db; // มีแค่ฝั่งเดียว → ต่าง; ว่างทั้งคู่ → ไม่ต่าง
        }
      } else {
        const na = ga ? ga.nums[i] : null;
        const nb = gb ? gb.nums[i] : null;
        va = na;
        vb = nb;
        if (na !== null) summary.perField[i].sumA = (summary.perField[i].sumA ?? 0) + na;
        if (nb !== null) summary.perField[i].sumB = (summary.perField[i].sumB ?? 0) + nb;
        diff = roundDiff((na ?? 0) - (nb ?? 0));
        bad = Math.abs(diff) > tol;
      }
      row.push(va, vb, diff);
      if (ga && gb && bad) mismatched.push(m.name);
      if (diff !== null && diff !== 0) {
        summary.perField[i].totalAbsDiff += Math.abs(diff);
        summary.perField[i].rowsDiff++;
      }
    });

    let status: Status;
    if (ga && !gb) {
      status = "Missing B";
      summary.missingB++;
    } else if (!ga && gb) {
      status = "Missing A";
      summary.missingA++;
    } else if (mismatched.length > 0) {
      status = "Mismatch";
      summary.mismatch++;
    } else {
      status = "Match";
      summary.match++;
    }
    row.push(status, status === "Mismatch" ? mismatched.join(", ") : "");
    rows[r] = row;
  });

  return { columns, rows, keys: common, fields: meta, statusCol, mismatchedCol, summary, notes, info: null };
}
