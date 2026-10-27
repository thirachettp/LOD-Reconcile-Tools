import { dayToIso, formatDay, isDateLike, isMissing, parseDay, toNumber } from "./dates";
import type {
  Cell,
  CompareOptions,
  CompareResult,
  CompareSummary,
  FieldMeta,
  Status,
  Table,
} from "./types";

interface Group {
  keyDisplay: Cell[];
  nums: (number | null)[];
  days: (number | null)[];
}

const SEP = "\u0001";

function normKey(v: Cell, isDate: boolean, fuzzy: boolean): string {
  if (isDate) {
    const d = parseDay(v, "dmy");
    return d === null ? "" : dayToIso(d);
  }
  if (isMissing(v)) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "number" ? String(v) : String(v);
  if (typeof v === "string" && !fuzzy) return v; // เทียบตรงตามที่ได้รับ ไม่ trim
  if (fuzzy) s = s.trim().toLowerCase();
  return s;
}

function colValues(t: Table, idx: number): Cell[] {
  return idx < 0 ? [] : t.rows.map((r) => r[idx]);
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
  fieldIsDate: boolean[],
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
      };
      map.set(key, g);
    } else {
      dup++;
    }
    fieldIdx.forEach((ix, f) => {
      const v = ix < 0 ? null : row[ix];
      if (fieldIsDate[f]) {
        const d = parseDay(v, "dmy");
        if (d !== null && (g!.days[f] === null || d < (g!.days[f] as number))) g!.days[f] = d;
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

  // ชนิดของ field/key ตัดสินจากข้อมูลสองฝั่งรวมกัน
  const fieldIsDate = fields.map((_, i) =>
    isDateLike([...colValues(stdA, fA[i]), ...colValues(stdB, fB[i])]),
  );
  const keyIsDate = common.map((_, i) =>
    isDateLike([...colValues(stdA, kA[i]), ...colValues(stdB, kB[i])]),
  );

  const A = aggregate(stdA, kA, keyIsDate, fA, fieldIsDate, opts.fuzzyKeys);
  const B = aggregate(stdB, kB, keyIsDate, fB, fieldIsDate, opts.fuzzyKeys);
  if (A.duplicates > 0) notes.push(`ฝั่ง A มี Key ซ้ำ ${A.duplicates.toLocaleString()} แถว — ถูกรวมยอดเข้าด้วยกัน`);
  if (B.duplicates > 0) notes.push(`ฝั่ง B มี Key ซ้ำ ${B.duplicates.toLocaleString()} แถว — ถูกรวมยอดเข้าด้วยกัน`);

  const allKeys = Array.from(new Set([...A.map.keys(), ...B.map.keys()])).sort((x, y) =>
    x.localeCompare(y, undefined, { numeric: true }),
  );

  const meta: FieldMeta[] = fields.map((f, i) => ({
    name: f,
    isDate: fieldIsDate[i],
    colA: `${f}_${opts.tagA}`,
    colB: `${f}_${opts.tagB}`,
    colDiff: `${f}_Diff`,
  }));

  const columns: string[] = [...common];
  for (const m of meta) columns.push(m.colA, m.colB, m.colDiff);
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
    perField: meta.map((m) => ({ name: m.name, isDate: m.isDate, totalAbsDiff: 0, rowsDiff: 0 })),
  };

  const tol = Math.abs(opts.tolerance || 0);

  allKeys.forEach((key, r) => {
    const ga = A.map.get(key);
    const gb = B.map.get(key);
    const row: Cell[] = [...(ga ?? gb)!.keyDisplay];
    const mismatched: string[] = [];

    meta.forEach((m, i) => {
      let va: Cell = null;
      let vb: Cell = null;
      let diff: number | null = null;
      let bad = false;
      if (m.isDate) {
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
        diff = roundDiff((na ?? 0) - (nb ?? 0));
        bad = Math.abs(diff) > tol;
      }
      row.push(va, vb, diff);
      if (ga && gb) {
        if (bad) mismatched.push(m.name);
        if (diff !== null && diff !== 0) {
          summary.perField[i].totalAbsDiff += Math.abs(diff);
          summary.perField[i].rowsDiff++;
        }
      } else if (diff !== null && diff !== 0) {
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

  return { columns, rows, keys: common, fields: meta, statusCol, mismatchedCol, summary, notes };
}
