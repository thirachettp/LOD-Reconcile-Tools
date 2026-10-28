"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { call, download } from "@/lib/engine-client";
import type { TableMeta } from "@/lib/engine.worker";
import type { SavedMapping } from "@/lib/library";
import { coverage, type Preset } from "@/lib/presets";
import {
  FUNCTIONS,
  FUNCTION_HINTS,
  SUMIF_OPERATORS,
  SYSTEM_LABELS,
  type FnName,
  type MappingRow,
  type SideCfg,
  type SumifOperator,
  type SystemCode,
} from "@/lib/types";
import { Alert, ColumnPicker, PreviewTable, Spinner, colLabel, fmtCell } from "./ui";

type Hints = Record<string, string>;

function hintsFrom(m: TableMeta | null): Hints {
  const out: Hints = {};
  if (!m) return out;
  m.columns.forEach((c, i) => {
    for (const r of m.preview) {
      const v = r[i];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        const s = fmtCell(v);
        out[c] = s.length > 22 ? s.slice(0, 21) + "…" : s;
        break;
      }
    }
  });
  return out;
}

function previewStr(cfg: SideCfg): string {
  const cols = cfg.columns.map(colLabel);
  if (cfg.function === "SUMIF") {
    const op = SUMIF_OPERATORS.find((o) => o.code === cfg.operator)?.label ?? "=";
    const sum = cols[0] ?? "?";
    const crit = cfg.criteria_column ? colLabel(cfg.criteria_column) : "?";
    if (cfg.operator === "is_blank" || cfg.operator === "is_not_blank") return `SUMIF(${sum}, ${crit} ${op})`;
    if (cfg.operator === "in_list" || cfg.operator === "not_in_list") {
      const v = cfg.criteria_values ?? [];
      return `SUMIF(${sum}, ${crit} ${op} [${v.slice(0, 3).join(", ")}${v.length > 3 ? "…" : ""}])`;
    }
    const val = cfg.criteria_mode === "column" ? (cfg.criteria_column2 ? colLabel(cfg.criteria_column2) : "?") : cfg.criteria_value || "?";
    return `SUMIF(${sum}, ${crit} ${op} ${val})`;
  }
  return cols.length ? `${cfg.function}(${cols.join(", ")})` : `${cfg.function}(…)`;
}

/** ตรวจว่า SUMIF ตั้งค่าครบหรือยัง — คืนรายการสิ่งที่ยังขาด (ว่าง = ครบ) */
export function sumifProblems(cfg: SideCfg): string[] {
  if (cfg.function !== "SUMIF") return [];
  const out: string[] = [];
  const op = cfg.operator ?? "==";
  if (!cfg.columns[0]) out.push("ยังไม่ได้เลือกคอลัมน์ที่จะรวม (Sum)");
  if (!cfg.criteria_column) out.push("ยังไม่ได้เลือกคอลัมน์เงื่อนไข (Criteria)");
  if (op === "in_list" || op === "not_in_list") {
    if (!(cfg.criteria_values ?? []).length) out.push("ยังไม่ได้ระบุค่าในกลุ่ม");
  } else if (op !== "is_blank" && op !== "is_not_blank") {
    if (cfg.criteria_mode === "column") {
      if (!cfg.criteria_column2) out.push("ยังไม่ได้เลือกคอลัมน์ที่จะเปรียบเทียบ");
    } else if (!(cfg.criteria_value ?? "").trim()) out.push("ยังไม่ได้ระบุค่าเปรียบเทียบ");
  }
  return out;
}

/** ตั้งค่า SUMIF เป็นกรอบเต็มใต้แถว (ไม่ซ่อนใน popover) */
function SumifEditor({
  cfg,
  cols,
  side,
  hints,
  onChange,
}: {
  cfg: SideCfg;
  cols: string[];
  side: "a" | "b";
  hints: Hints;
  onChange: (c: SideCfg) => void;
}) {
  const [vals, setVals] = useState<string[] | null | undefined>(undefined);
  const op = cfg.operator ?? "==";
  const needsList = op === "in_list" || op === "not_in_list";
  const noValue = op === "is_blank" || op === "is_not_blank";
  const listId = useId();
  const crit = cfg.criteria_column ?? null;

  // ดึงค่าที่ไม่ซ้ำของคอลัมน์เงื่อนไข ไว้เป็นตัวเลือก (ไม่เกิน 200 ค่า) — ใช้ทั้ง "อยู่ในกลุ่ม" และเป็นคำแนะนำของค่าคงที่
  useEffect(() => {
    let off = false;
    if (!crit || noValue || !cols.includes(crit)) {
      setVals(undefined);
      return;
    }
    call("distinct", { side, column: crit, limit: 200 })
      .then((v) => !off && setVals(v))
      .catch(() => !off && setVals(undefined));
    return () => {
      off = true;
    };
  }, [crit, side, noValue, cols]);

  return (
    <div className="sumif-panel">
      <div className="sumif-title">⚙️ ตั้งค่า SUMIF — ฝั่ง {side.toUpperCase()}</div>
      <div className="sumif-grid">
        <label className="f">
          รวมคอลัมน์ (Sum)
          <ColumnPicker single hints={hints} options={cols} value={cfg.columns.slice(0, 1)} onChange={(v) => onChange({ ...cfg, columns: v })} />
        </label>
        <label className="f">
          เงื่อนไขคอลัมน์ (Criteria)
          <ColumnPicker single hints={hints} options={cols} value={cfg.criteria_column ? [cfg.criteria_column] : []} onChange={(v) => onChange({ ...cfg, criteria_column: v[0] ?? null })} />
        </label>
        <label className="f">
          Operator
          <select className="select" value={op} onChange={(e) => onChange({ ...cfg, operator: e.target.value as SumifOperator, criteria_mode: cfg.criteria_mode ?? "const" })}>
            {SUMIF_OPERATORS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="f">
          {noValue ? (
            <span className="muted" style={{ paddingTop: 20 }}>ไม่ต้องระบุค่าเปรียบเทียบ</span>
          ) : needsList ? (
            vals ? (
              <label className="f">
                ค่าที่อยู่ในกลุ่ม
                <ColumnPicker options={vals} value={cfg.criteria_values ?? []} onChange={(v) => onChange({ ...cfg, criteria_values: v })} placeholder="พิมพ์หรือเลือกค่า…" />
              </label>
            ) : (
              <label className="f">
                ค่าที่อยู่ในกลุ่ม (คั่นด้วย comma)
                <input
                  className="input"
                  placeholder="เช่น A,B,C"
                  value={(cfg.criteria_values ?? []).join(",")}
                  onChange={(e) => onChange({ ...cfg, criteria_values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                />
              </label>
            )
          ) : (
            <>
              <div className="seg" style={{ marginBottom: 4 }}>
                <button type="button" className={(cfg.criteria_mode ?? "const") === "const" ? "on" : ""} onClick={() => onChange({ ...cfg, criteria_mode: "const" })}>
                  ค่าคงที่
                </button>
                <button type="button" className={cfg.criteria_mode === "column" ? "on" : ""} onClick={() => onChange({ ...cfg, criteria_mode: "column" })}>
                  อีกคอลัมน์
                </button>
              </div>
              {cfg.criteria_mode === "column" ? (
                <ColumnPicker single hints={hints} options={cols} value={cfg.criteria_column2 ? [cfg.criteria_column2] : []} onChange={(v) => onChange({ ...cfg, criteria_column2: v[0] ?? null })} />
              ) : (
                <>
                  <input className="input" list={listId} placeholder="พิมพ์ค่า เช่น GOOD หรือ 100 (หรือเลือกจากรายการ)" value={cfg.criteria_value ?? ""} onChange={(e) => onChange({ ...cfg, criteria_value: e.target.value })} />
                  {vals && (
                    <datalist id={listId}>
                      {vals.map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SideEditor({
  cfg,
  cols,
  side,
  hints,
  missing,
  onChange,
}: {
  cfg: SideCfg;
  cols: string[];
  side: "a" | "b";
  hints: Hints;
  missing: string[];
  onChange: (c: SideCfg) => void;
}) {
  return (
    <>
      <div>
        <select className="select" value={cfg.function} title={FUNCTION_HINTS[cfg.function]} onChange={(e) => onChange({ ...cfg, function: e.target.value as FnName })}>
          {FUNCTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div>
        {cfg.function === "SUMIF" ? (
          <div className="muted" style={{ paddingTop: 8 }}>
            ⚙️ ตั้งค่า SUMIF ในกรอบด้านล่าง ↓
          </div>
        ) : (
          <ColumnPicker options={cols} hints={hints} value={cfg.columns} onChange={(v) => onChange({ ...cfg, columns: v })} />
        )}
      </div>
      <div className={`fpv ${missing.length ? "miss" : ""}`} title={missing.length ? `ไม่พบคอลัมน์: ${missing.map(colLabel).join(", ")}` : FUNCTION_HINTS[cfg.function]}>
        {previewStr(cfg)}
        {missing.length > 0 && <div style={{ fontSize: 11 }}>⚠ ไม่พบ: {missing.map(colLabel).join(", ")}</div>}
      </div>
    </>
  );
}

export interface BuildInfo {
  a: TableMeta;
  b: TableMeta;
  warnings: string[];
}

export type SaveResult = { ok: true } | { ok: false; taken?: boolean; error: string };

export interface LibraryApi {
  saved: SavedMapping[];
  builtins: SavedMapping[];
  current: { id: string; name: string; builtin?: boolean } | null;
  dirty: boolean;
  /** id = "" → กลับไปใช้สูตรตั้งต้นของคู่ระบบ */
  onLoad: (id: string) => void;
  onSave: (name: string, o: { asNew: boolean; overwrite?: boolean }) => SaveResult;
  onRename: (name: string) => SaveResult;
  onDelete: () => void;
}

function LibraryCard({ lib, sysA, sysB, preset, touched, onImport, onExport }: {
  lib: LibraryApi;
  sysA: SystemCode;
  sysB: SystemCode;
  preset: Preset;
  touched: boolean;
  onImport: (text: string) => void;
  onExport: () => void;
}) {
  const importRef = useRef<HTMLInputElement>(null);
  const [naming, setNaming] = useState<null | "new" | "rename">(null);
  const [nameText, setNameText] = useState("");
  const [taken, setTaken] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad" | "warn"; text: string } | null>(null);
  const cur = lib.current;
  const userSaved = !!cur && !cur.builtin;

  const clearUi = () => {
    setMsg(null);
    setNaming(null);
    setTaken(false);
  };

  const sortPair = (list: SavedMapping[]) => [...list].sort((x, y) => Number(y.sysA === sysA && y.sysB === sysB) - Number(x.sysA === sysA && x.sysB === sysB));
  const optLabel = (m: SavedMapping) => `${m.sysA === sysA && m.sysB === sysB ? "★ " : ""}${m.name} · ${SYSTEM_LABELS[m.sysA]} ↔ ${SYSTEM_LABELS[m.sysB]}`;

  const startNew = () => {
    setNameText(cur?.name ?? `${SYSTEM_LABELS[sysA]} vs ${SYSTEM_LABELS[sysB]}`);
    setTaken(false);
    setMsg(null);
    setNaming("new");
  };

  const submit = (overwrite = false) => {
    const res = naming === "rename" ? lib.onRename(nameText) : lib.onSave(nameText, { asNew: true, overwrite });
    if (res.ok) {
      setNaming(null);
      setTaken(false);
      setMsg({ kind: "ok", text: naming === "rename" ? `เปลี่ยนชื่อเป็น “${nameText.trim()}” แล้ว` : `บันทึก “${nameText.trim()}” ไว้ในเว็บแล้ว` });
    } else {
      setTaken(!!res.taken && naming === "new");
      setMsg({ kind: res.taken ? "warn" : "bad", text: res.error });
    }
  };

  const quickSave = () => {
    if (!cur || cur.builtin) return startNew();
    const res = lib.onSave(cur.name, { asNew: false });
    setMsg(res.ok ? { kind: "ok", text: `บันทึกทับ “${cur.name}” แล้ว` } : { kind: "bad", text: res.error });
  };

  return (
    <div className="card">
      <div className="card-label">💾 Mapping ที่บันทึกไว้ในเว็บ</div>
      <div className="lib-row">
        <select className="select" value={cur?.id ?? ""} onChange={(e) => {
            clearUi();
            lib.onLoad(e.target.value);
          }}
          aria-label="เลือก Mapping">
          <option value="">สูตรตั้งต้นของคู่ระบบ ({SYSTEM_LABELS[sysA]} ↔ {SYSTEM_LABELS[sysB]})</option>
          {lib.builtins.length > 0 && (
            <optgroup label="ตัวอย่างในระบบ">
              {sortPair(lib.builtins).map((m) => (
                <option key={m.id} value={m.id}>
                  {optLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
          {lib.saved.length > 0 && (
            <optgroup label="ที่ฉันบันทึกไว้">
              {sortPair(lib.saved).map((m) => (
                <option key={m.id} value={m.id}>
                  {optLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button className="btn small primary" onClick={quickSave}>
          💾 {userSaved ? "บันทึกทับ" : "บันทึก"}
        </button>
        <button className="btn small" onClick={startNew}>
          ＋ บันทึกเป็นชื่อใหม่
        </button>
        {userSaved && (
          <>
            <button
              className="btn small"
              onClick={() => {
                setNameText(cur!.name);
                setTaken(false);
                setMsg(null);
                setNaming("rename");
              }}
            >
              ✏️ เปลี่ยนชื่อ
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm(`ลบ Mapping “${cur!.name}” ออกจากเว็บ?`)) {
                  clearUi();
                  lib.onDelete();
                }
              }}
            >
              🗑 ลบ
            </button>
          </>
        )}
        <span className="spacer" />
        <button className="btn small" onClick={() => importRef.current?.click()} title="นำเข้าไฟล์ .json ที่เคย Export">
          📥 นำเข้าไฟล์
        </button>
        <button className="btn small" onClick={onExport} title="ดาวน์โหลดเป็นไฟล์ .json ไว้สำรอง/ส่งต่อ">
          📤 ส่งออกไฟล์
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onImport(await f.text());
            e.target.value = "";
          }}
        />
      </div>

      {naming && (
        <div className="lib-row" style={{ marginTop: 10 }}>
          <input
            className="input"
            style={{ maxWidth: 360 }}
            autoFocus
            maxLength={80}
            placeholder="ตั้งชื่อ Mapping เช่น FC vs Initialstock"
            value={nameText}
            onChange={(e) => {
              setNameText(e.target.value);
              setTaken(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setNaming(null);
            }}
          />
          <button className="btn small primary" disabled={!nameText.trim()} onClick={() => submit()}>
            {naming === "rename" ? "เปลี่ยนชื่อ" : "บันทึก"}
          </button>
          {taken && (
            <button className="btn small danger" onClick={() => submit(true)}>
              บันทึกทับชื่อเดิม
            </button>
          )}
          <button className="btn small" onClick={() => setNaming(null)}>
            ยกเลิก
          </button>
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="row" style={{ marginTop: 10 }}>
        {cur ? (
          <span className={`badge ${lib.dirty ? "warn" : "ok"}`}>{lib.dirty ? "แก้ไขแล้ว (ยังไม่ได้บันทึก)" : cur.builtin ? "ตัวอย่างในระบบ" : "บันทึกแล้ว"}</span>
        ) : (
          <span className={`badge ${touched ? "warn" : "ok"}`}>{touched ? "กำหนดเอง (ยังไม่ได้ตั้งชื่อ)" : "สูตรตั้งต้น"}</span>
        )}
        <strong>{cur ? cur.name : preset.title}</strong>
      </div>
      {!cur && preset.note && <div className="muted" style={{ marginTop: 6 }}>ℹ️ {preset.note}</div>}
      <div className="muted" style={{ marginTop: 6 }}>
        เก็บไว้ในเบราว์เซอร์นี้ (ไม่ส่งขึ้นเซิร์ฟเวอร์) — ใช้เบราว์เซอร์/เครื่องอื่นให้ “ส่งออกไฟล์” แล้ว “นำเข้าไฟล์” · Key และ Compare Fields ที่เลือกในขั้นตอน Compare จะถูกบันทึกไปด้วย
      </div>
    </div>
  );
}

export function MappingStep(props: {
  rows: MappingRow[];
  onRows: (r: MappingRow[]) => void;
  sysA: SystemCode;
  sysB: SystemCode;
  tableA: TableMeta | null;
  tableB: TableMeta | null;
  nameA: string;
  nameB: string;
  preset: Preset;
  touched: boolean;
  lib: LibraryApi;
  onImport: (text: string) => void;
  onExport: () => void;
  build: BuildInfo | null;
  building: boolean;
  error: string | null;
  onBuild: () => void;
  onBack: () => void;
}) {
  const { rows } = props;
  const colsA = useMemo(() => props.tableA?.columns ?? [], [props.tableA]);
  const colsB = useMemo(() => props.tableB?.columns ?? [], [props.tableB]);
  const hintsA = useMemo(() => hintsFrom(props.tableA), [props.tableA]);
  const hintsB = useMemo(() => hintsFrom(props.tableB), [props.tableB]);
  const cov = coverage(rows, colsA, colsB);
  const covMap = (id: string, side: "a" | "b") => cov.find((c) => c.rowId === id && c.side === side)?.missing ?? [];

  const targets = rows.map((r) => r.target.trim()).filter(Boolean);
  const dups = Array.from(new Set(targets.filter((t, i) => targets.indexOf(t) !== i)));
  const incomplete = rows.flatMap((r) =>
    (["a", "b"] as const).flatMap((side) => sumifProblems(r[side]).map((p) => `${r.target.trim() || "(ไม่มีชื่อ)"} ฝั่ง ${side.toUpperCase()}: ${p}`)),
  );
  const patch = (id: string, fn: (r: MappingRow) => MappingRow) => props.onRows(rows.map((r) => (r.id === id ? fn(r) : r)));

  const previews = [
    { side: "A", name: props.nameA, sys: props.sysA, t: props.tableA },
    { side: "B", name: props.nameB, sys: props.sysB, t: props.tableB },
  ];

  return (
    <div>
      <div className="sec-title">Mapping สูตร</div>
      <div className="sec-sub">กำหนด Target Field ชุดเดียวใช้ร่วมกันทั้งสองฝั่ง — ระบบเตรียมสูตรตั้งต้นของคู่ระบบให้แล้ว ตรวจและแก้เฉพาะที่ไม่ตรงได้เลย</div>

      <LibraryCard lib={props.lib} sysA={props.sysA} sysB={props.sysB} preset={props.preset} touched={props.touched} onImport={props.onImport} onExport={props.onExport} />

      {cov.length > 0 && (
        <Alert kind="warn">
          ไฟล์ที่อัปโหลดไม่มีบางคอลัมน์ที่สูตรอ้างถึง — ตรวจว่าเลือกระบบ/Mapping ถูกคู่หรือไม่ หรือเลือกคอลัมน์ใหม่ในแถวที่ขึ้นสีแดง
          <ul>
            {cov.map((c) => (
              <li key={c.rowId + c.side}>
                {c.target || "(ไม่มีชื่อ)"} ฝั่ง {c.side.toUpperCase()}: ไม่พบ {c.missing.map(colLabel).join(", ")}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="card">
        <div className="card-label">👁️ ตัวอย่างข้อมูลดิบ (8 แถวแรก) — ดูประกอบการเลือกคอลัมน์</div>
        <div className="grid2">
          {previews.map((p) => (
            <details key={p.side} open>
              <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>
                {p.side} · {SYSTEM_LABELS[p.sys]} · {p.name}
                {p.t ? <span className="muted"> — {p.t.rowCount.toLocaleString()} แถว × {p.t.columns.length} คอลัมน์</span> : null}
              </summary>
              {p.t ? <PreviewTable columns={p.t.columns.map(colLabel)} rows={p.t.preview} max={8} /> : <span className="muted">ยังไม่มีข้อมูล</span>}
            </details>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="map-head">
          <div />
          <div className="map-group" style={{ gridColumn: "span 3" }} title={props.nameA}>
            {props.nameA} — {props.sysA}
          </div>
          <div className="map-group" style={{ gridColumn: "span 3" }} title={props.nameB}>
            {props.nameB} — {props.sysB}
          </div>
          <div />
        </div>
        <div className="map-head">
          <div>Target Field</div>
          <div>Fn</div>
          <div>Source Columns</div>
          <div>Preview</div>
          <div>Fn</div>
          <div>Source Columns</div>
          <div>Preview</div>
          <div />
        </div>
        {rows.map((r) => (
          <div className="map-row" key={r.id}>
            <input className="input" placeholder="เช่น SKU, Qty" value={r.target} onChange={(e) => patch(r.id, (x) => ({ ...x, target: e.target.value }))} />
            <SideEditor cfg={r.a} cols={colsA} side="a" hints={hintsA} missing={covMap(r.id, "a")} onChange={(c) => patch(r.id, (x) => ({ ...x, a: c }))} />
            <SideEditor cfg={r.b} cols={colsB} side="b" hints={hintsB} missing={covMap(r.id, "b")} onChange={(c) => patch(r.id, (x) => ({ ...x, b: c }))} />
            <button className="btn small danger" title="ลบ Target Field นี้ (ทั้ง A และ B)" onClick={() => props.onRows(rows.filter((x) => x.id !== r.id))}>
              🗑
            </button>
            {r.a.function === "SUMIF" && (
              <div className="sumif-slot sumif-a">
                <SumifEditor cfg={r.a} cols={colsA} side="a" hints={hintsA} onChange={(c) => patch(r.id, (x) => ({ ...x, a: c }))} />
              </div>
            )}
            {r.b.function === "SUMIF" && (
              <div className="sumif-slot sumif-b">
                <SumifEditor cfg={r.b} cols={colsB} side="b" hints={hintsB} onChange={(c) => patch(r.id, (x) => ({ ...x, b: c }))} />
              </div>
            )}
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <button
            className="btn small"
            onClick={() =>
              props.onRows([
                ...rows,
                { id: `n${Date.now().toString(36)}`, target: "", a: { function: "FIRST", columns: [] }, b: { function: "FIRST", columns: [] } },
              ])
            }
          >
            ＋ เพิ่ม Target Field
          </button>
          <span className="muted" style={{ marginLeft: 10 }}>
            ช่อง Source Columns: พิมพ์ชื่อเพื่อค้นหา แล้วเลือก/กด Enter · กด × เพื่อลบ · เลือกได้เฉพาะคอลัมน์ที่มีในไฟล์ · เลือกหลายคอลัมน์ใน FIRST = ใช้ค่าแรกที่ไม่ว่าง
          </span>
        </div>
        {incomplete.length > 0 && (
          <Alert kind="warn">
            SUMIF ตั้งค่ายังไม่ครบ (ถ้าไม่แก้ ค่าของ Target Field นั้นจะว่างทั้งคอลัมน์):
            <ul>
              {incomplete.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Alert>
        )}
        {dups.length > 0 && <Alert kind="warn">มี Target Field ชื่อซ้ำ: {dups.join(", ")} — กรุณาตั้งชื่อให้ไม่ซ้ำกัน</Alert>}
      </div>

      <div className="row">
        <button className="btn" onClick={props.onBack}>
          ← กลับ
        </button>
        <span className="spacer" />
        {props.building && <Spinner label="กำลัง Build…" />}
        <button className="btn primary" disabled={props.building || dups.length > 0 || targets.length === 0 || incomplete.length > 0} onClick={props.onBuild}>
          🔨 Build Standard Tables แล้วไปต่อ →
        </button>
      </div>
      {props.error && <Alert kind="bad">{props.error}</Alert>}

      {props.build && (
        <div style={{ marginTop: 16 }}>
          {props.build.warnings.length > 0 && (
            <Alert kind="warn">
              <strong>ข้อควรตรวจสอบ</strong>
              <ul>
                {props.build.warnings.slice(0, 12).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="grid2">
            {(["a", "b"] as const).map((s) => {
              const t = props.build![s];
              return (
                <div key={s}>
                  <div className="card-label">
                    Standard Table {s.toUpperCase()} — {t.rowCount.toLocaleString()} แถว
                  </div>
                  <PreviewTable columns={t.columns} rows={t.preview} max={8} />
                  <button
                    className="btn small"
                    style={{ marginTop: 8 }}
                    onClick={async () => download(await call("exportStd", { side: s }), `Standard_${s.toUpperCase()}.csv`, "text/csv;charset=utf-8")}
                  >
                    📥 Export CSV
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
