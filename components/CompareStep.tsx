"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { call, download } from "@/lib/engine-client";
import type { CompareMeta, StatusFilter } from "@/lib/engine.worker";
import type { Cell, RunInfo, SideInfo } from "@/lib/types";
import { Alert, ColumnPicker, Spinner, fmtCell } from "./ui";
import { ReportCard } from "./ReportCard";
import { defaultSideName, makeItem, type ReportItem } from "@/lib/report";

export interface CompareSel {
  keys?: string[];
  fields?: string[];
}

function SideCard({ label, side }: { label: string; side: SideInfo }) {
  const shown = side.files.slice(0, 6);
  return (
    <div className="info-card">
      <div className="row">
        <span className="badge info">ฝั่ง {label}</span>
        <strong>{side.system}</strong>
        <span className="spacer" />
        <span className="muted">{side.rowCount.toLocaleString()} แถวดิบ</span>
      </div>
      <ul className="files">
        {shown.map((f) => (
          <li key={f}>{f}</li>
        ))}
        {side.files.length > shown.length && <li className="muted">…และอีก {side.files.length - shown.length} ไฟล์</li>}
        {side.files.length === 0 && <li className="muted">-</li>}
      </ul>
    </div>
  );
}

const PAGE = 100;
const FILTERS: StatusFilter[] = ["All", "Match", "Mismatch", "Missing A", "Missing B"];

function statusClass(s: string) {
  if (s === "Match") return "st-Match";
  if (s === "Mismatch") return "st-Mismatch";
  return "st-Missing";
}

function ResultTable({ meta, pairId }: { meta: CompareMeta; pairId?: string }) {
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Cell[][] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let off = false;
    setLoading(true);
    call("page", { pairId, filter, search: q, sortCol: sort?.col ?? null, sortDir: sort?.dir ?? "desc", offset: page * PAGE, limit: PAGE })
      .then((r) => !off && setData(r))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [meta, filter, q, sort, page, pairId]);

  const s = meta.summary;
  const counts: Record<StatusFilter, number> = { All: s.total, Match: s.match, Mismatch: s.mismatch, "Missing A": s.missingA, "Missing B": s.missingB };
  const pages = Math.max(1, Math.ceil(data.total / PAGE));

  const clickSort = (col: string) => {
    setPage(0);
    setSort((cur) => (cur?.col === col ? (cur.dir === "desc" ? { col, dir: "asc" } : null) : { col, dir: "desc" }));
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => { setFilter(f); setPage(0); }}>
              {f}
              <span className="n">{counts[f].toLocaleString()}</span>
            </button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder={`ค้นหา ${meta.keys.join(" / ")}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        {loading && <Spinner />}
        <span className="muted">
          แสดง {data.total.toLocaleString()} จาก {s.total.toLocaleString()} แถว
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {meta.columns.map((c) => {
                const sortable = c.endsWith("_Diff") || meta.keys.includes(c);
                return (
                  <th key={c} className={sortable ? "sortable" : ""} onClick={sortable ? () => clickSort(c) : undefined} title={c.endsWith("_Diff") ? "คลิกเพื่อเรียงตามความต่างสูงสุด" : undefined}>
                    {c}
                    {sort?.col === c ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => {
                  const col = meta.columns[j] ?? "";
                  let cls = typeof v === "number" ? "num" : "";
                  if (j === meta.statusCol) cls = statusClass(String(v));
                  else if (col.endsWith("_Diff") && typeof v === "number") cls += v > 0 ? " d-pos" : v < 0 ? " d-neg" : " d-zero";
                  return (
                    <td key={j} className={cls}>
                      {fmtCell(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.rows.length === 0 && !loading && (
              <tr>
                <td colSpan={meta.columns.length} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  ไม่มีข้อมูล
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← ก่อนหน้า
        </button>
        <span className="muted">
          หน้า {page + 1} / {pages}
        </span>
        <button className="btn small" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          ถัดไป →
        </button>
        <span className="spacer" />
        <button
          className="btn small"
          onClick={async () => download(await call("exportCsv", { pairId, filter, search: q, sortCol: sort?.col ?? null, sortDir: sort?.dir ?? "desc" }), `Compare_${filter.replace(" ", "")}.csv`, "text/csv;charset=utf-8")}
        >
          📥 CSV (ตามตัวกรองปัจจุบัน)
        </button>
      </div>
    </>
  );
}

export function CompareStep(props: {
  stdColsA: string[];
  stdColsB: string[];
  defaultFields?: string[];
  tagA: string;
  tagB: string;
  meta: CompareMeta | null;
  onMeta: (m: CompareMeta | null) => void;
  onBack: () => void;
  runInfo: { mappingName: string | null; a: SideInfo; b: SideInfo };
  /** Key / Compare Fields ที่โหลดมากับ Mapping (selVersion เปลี่ยน = โหลดใหม่) */
  sel: CompareSel;
  selVersion: number;
  onSel: (s: CompareSel) => void;
  report: ReportItem[];
  onReport: (r: ReportItem[]) => void;
  /** โหมดหลายคู่: id ของคู่ และซ่อนการ์ดรายงานรายคู่ (ใช้รายงานรวมแทน) */
  pairId?: string;
  hideReport?: boolean;
}) {
  const common = useMemo(() => props.stdColsA.filter((c) => props.stdColsB.includes(c)), [props.stdColsA, props.stdColsB]);
  const [keys, setKeys] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [fuzzy, setFuzzy] = useState(false);
  const [tol, setTol] = useState("0");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repTitle, setRepTitle] = useState("");
  const [repTitleTouched, setRepTitleTouched] = useState(false);

  // ค่าเริ่มต้น: Key/Fields จาก Mapping ที่โหลดมา ไม่ก็ Key = SKU+Location และ Fields = ตามชุดสูตร (หรือทุกฟิลด์ร่วม)
  useEffect(() => {
    const wantKeys = props.sel.keys?.filter((k) => common.includes(k));
    const dk = ["SKU", "Location"].filter((x) => common.includes(x));
    const kk = wantKeys && wantKeys.length ? wantKeys : dk.length ? dk : common.slice(0, 1);
    setKeys(kk);
    const rest = common.filter((c) => !kk.includes(c));
    const wantFields = props.sel.fields?.filter((f) => rest.includes(f));
    const pref = props.defaultFields?.filter((f) => rest.includes(f));
    setFields(wantFields && wantFields.length ? wantFields : pref && pref.length ? pref : rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [common.join("|"), (props.defaultFields ?? []).join("|"), props.selVersion]);

  const changeKeys = (v: string[]) => {
    const f = fields.filter((x) => !v.includes(x));
    setKeys(v);
    setFields(f);
    props.onSel({ keys: v, fields: f });
  };
  const changeFields = (v: string[]) => {
    setFields(v);
    props.onSel({ keys, fields: v });
  };

  const run = useCallback(async () => {
    setError(null);
    setRunning(true);
    try {
      const m = await call("compare", {
        pairId: props.pairId,
        keys,
        fields: fields.filter((f) => !keys.includes(f)),
        opts: { fuzzyKeys: fuzzy, tolerance: Math.abs(Number(tol) || 0), tagA: props.tagA, tagB: props.tagB },
        info: {
          ...props.runInfo,
          generatedAt: new Date().toISOString(),
          tolerance: Math.abs(Number(tol) || 0),
          fuzzyKeys: fuzzy,
        } satisfies RunInfo,
      });
      props.onMeta(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [keys, fields, fuzzy, tol, props]);

  const m = props.meta;
  const autoTitle = `${defaultSideName(m?.info?.a ?? props.runInfo.a)} vs ${defaultSideName(m?.info?.b ?? props.runInfo.b)}`;
  const shownTitle = repTitleTouched ? repTitle : autoTitle;
  const pct = m && m.summary.total ? (m.summary.match / m.summary.total) * 100 : 0;

  return (
    <div>
      <div className="sec-title">Compare & Dashboard</div>
      <div className="sec-sub">เลือก Key ที่ใช้จับคู่แถว และฟิลด์ที่ต้องการเทียบ</div>

      <div className="card">
        <div className="grid2">
          <div>
            <div className="card-label">⚙️ Key Columns (Join Keys)</div>
            <ColumnPicker options={common} value={keys} onChange={changeKeys} />
          </div>
          <div>
            <div className="card-label">📋 Compare Fields</div>
            <ColumnPicker options={common.filter((c) => !keys.includes(c))} value={fields} onChange={changeFields} />
          </div>
        </div>
        <hr className="s" />
        <div className="row">
          <label className="row" style={{ gap: 6 }} title="ตัดช่องว่างหัวท้ายและไม่สนตัวพิมพ์เล็ก/ใหญ่ตอนจับคู่ Key และเทียบฟิลด์ข้อความ (ปกติเทียบตรงตามตัวอักษร)">
            <input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} />
            จับคู่แบบหลวม (ตัดช่องว่าง / ไม่สนตัวพิมพ์ — ใช้กับ Key และฟิลด์ข้อความ)
          </label>
          <label className="row" style={{ gap: 6 }} title="ผลต่างตัวเลขไม่เกินค่านี้ถือว่าตรงกัน">
            ยอมให้ต่างได้ไม่เกิน
            <input className="input" style={{ width: 80 }} type="number" min={0} step="any" value={tol} onChange={(e) => setTol(e.target.value)} />
          </label>
          <span className="spacer" />
          <button className="btn" onClick={props.onBack}>
            ← กลับ
          </button>
          <button className="btn primary" disabled={running || keys.length === 0 || fields.length === 0} onClick={run}>
            {running ? "กำลัง Compare…" : "⚡ Run Compare"}
          </button>
        </div>
        {error && <Alert kind="bad">{error}</Alert>}
      </div>

      {m && (
        <>
          <div className="card-label">🗂️ ข้อมูลที่ใช้เทียบ</div>
          <div className="grid2" style={{ marginBottom: 12 }}>
            <SideCard label="A" side={m.info?.a ?? props.runInfo.a} />
            <SideCard label="B" side={m.info?.b ?? props.runInfo.b} />
          </div>
          <div className="muted" style={{ marginBottom: 12 }}>
            Mapping: <strong>{m.info?.mappingName ?? "-"}</strong> · Key: {m.keys.join(", ")} · เทียบ: {m.fields.map((f) => f.name).join(", ") || "-"}
            {m.info && m.info.tolerance > 0 ? ` · ยอมให้ต่างได้ ≤ ${m.info.tolerance}` : ""}
            {m.info?.fuzzyKeys ? " · จับคู่แบบหลวม" : ""}
          </div>
          {m.notes.length > 0 && (
            <Alert kind="warn">
              <ul>
                {m.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-v">{m.summary.total.toLocaleString()}</div>
              <div className="kpi-l">Total Rows</div>
            </div>
            <div className="kpi match">
              <div className="kpi-v">{m.summary.match.toLocaleString()}</div>
              <div className="kpi-l">Match ({pct.toFixed(1)}%)</div>
            </div>
            <div className="kpi mis">
              <div className="kpi-v">{m.summary.mismatch.toLocaleString()}</div>
              <div className="kpi-l">Mismatch</div>
            </div>
            <div className="kpi miss">
              <div className="kpi-v">{m.summary.missingA.toLocaleString()}</div>
              <div className="kpi-l">Missing A</div>
            </div>
            <div className="kpi miss">
              <div className="kpi-v">{m.summary.missingB.toLocaleString()}</div>
              <div className="kpi-l">Missing B</div>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="row muted" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <span>Match Rate</span>
              <span>{pct.toFixed(1)}%</span>
            </div>
            <div className="bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>

          {m.summary.perField.length > 0 && (
            <>
              <div className="card-label">📐 Total Diff ต่อ Field</div>
              <div className="kpis">
                {m.summary.perField.map((f) => (
                  <div className="kpi" key={f.name}>
                    <div className="kpi-v" style={{ fontSize: 22 }}>
                      {f.kind === "text"
                        ? f.rowsDiff.toLocaleString()
                        : f.totalAbsDiff.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {f.kind === "date" ? " วัน" : f.kind === "text" ? " แถว" : ""}
                    </div>
                    <div className="kpi-l">
                      {f.name}
                      {f.kind === "text" ? " (ข้อความ)" : ` · ${f.rowsDiff.toLocaleString()} แถวต่าง`}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!props.hideReport && (
          <ReportCard
            title={shownTitle}
            onTitle={(t) => {
              setRepTitle(t);
              setRepTitleTouched(true);
            }}
            items={props.report}
            canAdd={shownTitle.trim().length > 0}
            onAdd={() => {
              props.onReport([...props.report, makeItem(m, shownTitle.trim())]);
              setRepTitleTouched(false);
            }}
            onRemove={(id) => props.onReport(props.report.filter((x) => x.id !== id))}
            onClear={() => props.onReport([])}
          />
          )}

          <div className="card">
            <ResultTable pairId={props.pairId} key={`${m.info?.generatedAt ?? ""}|${m.columns.join("|")}`} meta={m} />
            <hr className="s" />
            <button
              className="btn primary"
              onClick={async () => {
                const buf = await call("exportXlsx", { pairId: props.pairId });
                const d = new Date();
                const stamp = `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getFullYear()).slice(2)}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
                download(buf, `CompareStock_${stamp}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
              }}
            >
              📥 Export Excel (6 sheets)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
