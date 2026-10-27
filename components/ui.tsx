"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { Cell } from "@/lib/types";

export function fmtCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return String(v);
}

export function Alert({ kind, children }: { kind: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="muted">
      <span className="spin" />
      {label}
    </span>
  );
}

/** Dropdown เลือกหลายคอลัมน์ (checkbox) — คอลัมน์ที่เลือกไว้แต่ไม่มีในไฟล์จะขึ้นเป็นชิปสีแดงขีดฆ่า */
export function ColumnPicker({
  options,
  value,
  onChange,
  placeholder = "เลือกคอลัมน์…",
  single = false,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  single?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (o: string) => {
    if (single) {
      onChange([o]);
      if (ref.current) ref.current.open = false;
      return;
    }
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  };

  return (
    <details className="picker" ref={ref}>
      <summary>
        {value.length === 0 && <span className="muted">{options.length ? placeholder : "อัปโหลดไฟล์ก่อน"}</span>}
        {value.map((v) => (
          <span key={v} className={`chip ${options.length && !options.includes(v) ? "missing" : ""}`} title={options.includes(v) || !options.length ? v : `ไม่พบคอลัมน์ "${v}" ในไฟล์`}>
            {v}
          </span>
        ))}
      </summary>
      {options.length > 0 && (
        <div className="picker-menu">
          {options.map((o) => (
            <label key={o}>
              <input type={single ? "radio" : "checkbox"} checked={value.includes(o)} onChange={() => toggle(o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      )}
    </details>
  );
}

export function Stepper({
  step,
  onStep,
  done,
  enabled,
}: {
  step: number;
  onStep: (n: number) => void;
  done: boolean[];
  enabled: boolean[];
}) {
  const labels = ["Upload Files", "Mapping สูตร", "Compare & Dashboard"];
  return (
    <div className="stepper">
      {labels.map((l, i) => {
        const n = i + 1;
        const cls = step === n ? "current" : done[i] ? "done" : "";
        return (
          <div key={l} style={{ display: "contents" }}>
            <button className={`step ${cls}`} disabled={!enabled[i]} onClick={() => onStep(n)}>
              <span className="step-circle">{done[i] && step !== n ? "✓" : n}</span>
              <span className="step-label">{l}</span>
            </button>
            {i < labels.length - 1 && <div className={`step-line ${done[i] ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function PreviewTable({ columns, rows, max = 10 }: { columns: string[]; rows: Cell[][]; max?: number }) {
  return (
    <div className="tbl-wrap" style={{ maxHeight: 320 }}>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={typeof v === "number" ? "num" : ""}>
                  {fmtCell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
