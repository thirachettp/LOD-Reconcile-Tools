"use client";
import { useRef, useState } from "react";
import { call, download } from "@/lib/engine-client";
import type { TableMeta } from "@/lib/engine.worker";
import { coverage, type Preset } from "@/lib/presets";
import {
  FUNCTIONS,
  FUNCTION_HINTS,
  SUMIF_OPERATORS,
  type FnName,
  type MappingRow,
  type SideCfg,
  type SumifOperator,
  type SystemCode,
} from "@/lib/types";
import { Alert, ColumnPicker, PreviewTable, Spinner } from "./ui";

function previewStr(cfg: SideCfg): string {
  const cols = cfg.columns;
  if (cfg.function === "SUMIF") {
    const op = SUMIF_OPERATORS.find((o) => o.code === cfg.operator)?.label ?? "=";
    const sum = cols[0] ?? "?";
    const crit = cfg.criteria_column ?? "?";
    if (cfg.operator === "is_blank" || cfg.operator === "is_not_blank") return `SUMIF(${sum}, ${crit} ${op})`;
    if (cfg.operator === "in_list" || cfg.operator === "not_in_list") {
      const v = cfg.criteria_values ?? [];
      return `SUMIF(${sum}, ${crit} ${op} [${v.slice(0, 3).join(", ")}${v.length > 3 ? "…" : ""}])`;
    }
    const val = cfg.criteria_mode === "column" ? cfg.criteria_column2 ?? "?" : cfg.criteria_value || "?";
    return `SUMIF(${sum}, ${crit} ${op} ${val})`;
  }
  return cols.length ? `${cfg.function}(${cols.join(", ")})` : `${cfg.function}(…)`;
}

function SumifEditor({ cfg, cols, side, onChange }: { cfg: SideCfg; cols: string[]; side: "a" | "b"; onChange: (c: SideCfg) => void }) {
  const [vals, setVals] = useState<string[] | null | undefined>(undefined);
  const op = cfg.operator ?? "==";
  const needsList = op === "in_list" || op === "not_in_list";
  const loadVals = async (col: string | null | undefined) => {
    if (!col) return setVals(undefined);
    setVals(await call("distinct", { side, column: col, limit: 200 }));
  };

  return (
    <details className="picker">
      <summary>
        <span className="chip">⚙️ ตั้งค่า SUMIF</span>
        <span className="muted">{cfg.columns[0] ?? "?"} ← {cfg.criteria_column ?? "?"}</span>
      </summary>
      <div className="picker-menu" style={{ width: 300, padding: 10 }}>
        <div className="pop">
          <label className="f">
            รวมคอลัมน์ (Sum)
            <ColumnPicker single options={cols} value={cfg.columns.slice(0, 1)} onChange={(v) => onChange({ ...cfg, columns: v })} />
          </label>
          <label className="f">
            เงื่อนไขคอลัมน์ (Criteria)
            <ColumnPicker
              single
              options={cols}
              value={cfg.criteria_column ? [cfg.criteria_column] : []}
              onChange={(v) => {
                onChange({ ...cfg, criteria_column: v[0] });
                if (needsList) void loadVals(v[0]);
              }}
            />
          </label>
          <label className="f">
            Operator
            <select
              className="select"
              value={op}
              onChange={(e) => {
                const o = e.target.value as SumifOperator;
                onChange({ ...cfg, operator: o, criteria_mode: cfg.criteria_mode ?? "const" });
                if (o === "in_list" || o === "not_in_list") void loadVals(cfg.criteria_column);
              }}
            >
              {SUMIF_OPERATORS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {op === "is_blank" || op === "is_not_blank" ? (
            <span className="muted">ไม่ต้องระบุค่าเปรียบเทียบ</span>
          ) : needsList ? (
            vals ? (
              <label className="f">
                ค่าที่อยู่ในกลุ่ม
                <ColumnPicker options={vals} value={cfg.criteria_values ?? []} onChange={(v) => onChange({ ...cfg, criteria_values: v })} placeholder="เลือกค่า…" />
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
              <div className="seg">
                <button className={(cfg.criteria_mode ?? "const") === "const" ? "on" : ""} onClick={() => onChange({ ...cfg, criteria_mode: "const" })}>
                  ค่าคงที่
                </button>
                <button className={cfg.criteria_mode === "column" ? "on" : ""} onClick={() => onChange({ ...cfg, criteria_mode: "column" })}>
                  อีกคอลัมน์
                </button>
              </div>
              {cfg.criteria_mode === "column" ? (
                <ColumnPicker single options={cols} value={cfg.criteria_column2 ? [cfg.criteria_column2] : []} onChange={(v) => onChange({ ...cfg, criteria_column2: v[0] })} />
              ) : (
                <input className="input" placeholder="เช่น GOOD หรือ 100" value={cfg.criteria_value ?? ""} onChange={(e) => onChange({ ...cfg, criteria_value: e.target.value })} />
              )}
            </>
          )}
        </div>
      </div>
    </details>
  );
}

function SideEditor({
  cfg,
  cols,
  side,
  missing,
  onChange,
}: {
  cfg: SideCfg;
  cols: string[];
  side: "a" | "b";
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
          <SumifEditor cfg={cfg} cols={cols} side={side} onChange={onChange} />
        ) : (
          <ColumnPicker options={cols} value={cfg.columns} onChange={(v) => onChange({ ...cfg, columns: v })} />
        )}
      </div>
      <div className={`fpv ${missing.length ? "miss" : ""}`} title={missing.length ? `ไม่พบคอลัมน์: ${missing.join(", ")}` : FUNCTION_HINTS[cfg.function]}>
        {previewStr(cfg)}
        {missing.length > 0 && <div style={{ fontSize: 11 }}>⚠ ไม่พบ: {missing.join(", ")}</div>}
      </div>
    </>
  );
}

export interface BuildInfo {
  a: TableMeta;
  b: TableMeta;
  warnings: string[];
}

export function MappingStep(props: {
  rows: MappingRow[];
  onRows: (r: MappingRow[]) => void;
  sysA: SystemCode;
  sysB: SystemCode;
  colsA: string[];
  colsB: string[];
  nameA: string;
  nameB: string;
  preset: Preset;
  touched: boolean;
  onResetPreset: () => void;
  onImport: (text: string) => void;
  onExport: () => void;
  build: BuildInfo | null;
  building: boolean;
  error: string | null;
  onBuild: () => void;
  onBack: () => void;
}) {
  const { rows, colsA, colsB } = props;
  const cov = coverage(rows, colsA, colsB);
  const covMap = (id: string, side: "a" | "b") => cov.find((c) => c.rowId === id && c.side === side)?.missing ?? [];
  const importRef = useRef<HTMLInputElement>(null);

  const targets = rows.map((r) => r.target.trim()).filter(Boolean);
  const dups = Array.from(new Set(targets.filter((t, i) => targets.indexOf(t) !== i)));
  const patch = (id: string, fn: (r: MappingRow) => MappingRow) => props.onRows(rows.map((r) => (r.id === id ? fn(r) : r)));

  return (
    <div>
      <div className="sec-title">Mapping สูตร</div>
      <div className="sec-sub">กำหนด Target Field ชุดเดียวใช้ร่วมกันทั้งสองฝั่ง — ระบบเตรียมสูตรตั้งต้นของคู่ระบบให้แล้ว ตรวจและแก้เฉพาะที่ไม่ตรงได้เลย</div>

      <div className="card">
        <div className="row">
          <span className={`badge ${props.touched ? "warn" : "ok"}`}>{props.touched ? "แก้ไขเอง" : "สูตรตั้งต้น"}</span>
          <strong>{props.preset.title}</strong>
          <span className="spacer" />
          <button className="btn small" onClick={props.onResetPreset}>
            ↺ กลับเป็นสูตรตั้งต้น
          </button>
          <button className="btn small" onClick={props.onExport}>
            📤 Export Mapping
          </button>
          <button className="btn small" onClick={() => importRef.current?.click()}>
            📥 Import Mapping
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) props.onImport(await f.text());
              e.target.value = "";
            }}
          />
        </div>
        {props.preset.note && <div className="muted" style={{ marginTop: 6 }}>ℹ️ {props.preset.note}</div>}
        {cov.length > 0 && (
          <Alert kind="warn">
            ไฟล์ที่อัปโหลดไม่มีบางคอลัมน์ที่สูตรตั้งต้นอ้างถึง — ตรวจว่าเลือกระบบถูกคู่หรือไม่ หรือเลือกคอลัมน์ใหม่ในแถวที่ขึ้นสีแดง
            <ul>
              {cov.map((c) => (
                <li key={c.rowId + c.side}>
                  {c.target || "(ไม่มีชื่อ)"} ฝั่ง {c.side.toUpperCase()}: ไม่พบ {c.missing.join(", ")}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="muted" style={{ marginTop: 6 }}>แก้ไขสูตรแล้วระบบจะจำไว้ให้ในเบราว์เซอร์นี้ สำหรับคู่ระบบเดิมครั้งหน้า</div>
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
            <SideEditor cfg={r.a} cols={colsA} side="a" missing={covMap(r.id, "a")} onChange={(c) => patch(r.id, (x) => ({ ...x, a: c }))} />
            <SideEditor cfg={r.b} cols={colsB} side="b" missing={covMap(r.id, "b")} onChange={(c) => patch(r.id, (x) => ({ ...x, b: c }))} />
            <button className="btn small danger" title="ลบ Target Field นี้ (ทั้ง A และ B)" onClick={() => props.onRows(rows.filter((x) => x.id !== r.id))}>
              🗑
            </button>
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
        </div>
        {dups.length > 0 && <Alert kind="warn">มี Target Field ชื่อซ้ำ: {dups.join(", ")} — กรุณาตั้งชื่อให้ไม่ซ้ำกัน</Alert>}
      </div>

      <div className="row">
        <button className="btn" onClick={props.onBack}>
          ← กลับ
        </button>
        <span className="spacer" />
        {props.building && <Spinner label="กำลัง Build…" />}
        <button className="btn primary" disabled={props.building || dups.length > 0 || targets.length === 0} onClick={props.onBuild}>
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
