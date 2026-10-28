"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/** ชื่อคอลัมน์สำหรับแสดงผล — ตัดช่องว่าง/ขึ้นบรรทัดท้ายที่มากับหัวตาราง */
export const colLabel = (v: string) => v.replace(/\s+/g, " ").trim() || v;

const normCol = (s: string) => s.trim().toLowerCase();

/**
 * ช่องเลือกคอลัมน์: พิมพ์ค้นหา/เลือกจากรายการ/กด × เพื่อลบ
 * - เพิ่มได้เฉพาะคอลัมน์ที่มีอยู่ในไฟล์ (พิมพ์ชื่อไม่ตรง = เพิ่มไม่ได้)
 * - คอลัมน์ที่เลือกไว้แต่ไม่มีในไฟล์ (เช่น มาจาก Mapping เก่า) แสดงเป็นชิปแดงขีดฆ่า และลบได้
 */
export function ColumnPicker({
  options,
  value,
  onChange,
  placeholder = "พิมพ์หรือเลือกคอลัมน์…",
  single = false,
  hints,
  inline = false,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  single?: boolean;
  /** ค่าตัวอย่างของแต่ละคอลัมน์ แสดงข้างชื่อในรายการ */
  hints?: Record<string, string>;
  /** แสดงรายการแบบแทรกในเนื้อหา (ใช้ใน popover ที่มี scroll) */
  inline?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navigated = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setText("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const avail = useMemo(() => options.filter((o) => single || !value.includes(o)), [options, value, single]);
  const q = normCol(text);
  const matches = useMemo(() => (q ? avail.filter((o) => normCol(o).includes(q)) : avail), [avail, q]);
  const exact = q ? avail.find((o) => normCol(o) === q) : undefined;
  const shown = matches.slice(0, 200);

  useEffect(() => {
    setActive(0);
    navigated.current = false;
  }, [text]);

  const choose = (o: string) => {
    onChange(single ? [o] : [...value, o]);
    setText("");
    setActive(0);
    if (single) setOpen(false);
    else inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      navigated.current = true;
      setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigated.current = true;
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = exact ?? (q || navigated.current ? shown[active] : undefined);
      if (pick) choose(pick);
    } else if (e.key === "Backspace" && !text && !single && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setText("");
    }
  };

  const disabled = options.length === 0;

  return (
    // ถ้าอยู่ใน <label> เบราว์เซอร์จะส่งคลิกต่อไปยังปุ่มแรกในนั้น (ปุ่ม × ของค่าที่เพิ่งเลือก) ทำให้ค่าที่เลือกถูกลบทันที → กันด้วย preventDefault
    <div className={`cp ${inline ? "inline" : ""}`} ref={ref} onClick={(e) => e.preventDefault()}>
      <div
        className={`cp-box ${open ? "open" : ""}`}
        onClick={() => {
          if (disabled) return;
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {value.map((v) => {
          const missing = options.length > 0 && !options.includes(v);
          return (
            <span key={v} className={`chip ${missing ? "missing" : ""}`} title={missing ? `ไม่พบคอลัมน์ “${colLabel(v)}” ในไฟล์` : v}>
              {colLabel(v)}
              <button
                type="button"
                className="x"
                aria-label={`ลบ ${colLabel(v)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((x) => x !== v));
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          className="cp-input"
          value={text}
          disabled={disabled}
          placeholder={value.length ? "" : disabled ? "อัปโหลดไฟล์ก่อน" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={onKey}
          aria-autocomplete="list"
        />
      </div>
      {open && !disabled && (
        <div className="cp-menu" role="listbox">
          {shown.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === active}
              className={`cp-item ${i === active ? "on" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="cp-name">{colLabel(o)}</span>
              {hints?.[o] ? <span className="cp-hint">{hints[o]}</span> : null}
            </div>
          ))}
          {shown.length === 0 && (
            <div className="cp-empty">
              {q ? `ไม่พบคอลัมน์ “${text.trim()}” ในไฟล์ — เลือกได้เฉพาะคอลัมน์ที่มีในไฟล์` : "เลือกครบทุกคอลัมน์แล้ว"}
            </div>
          )}
          {matches.length > shown.length && <div className="cp-empty">…แสดง 200 รายการแรก พิมพ์เพื่อค้นหา</div>}
        </div>
      )}
    </div>
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
