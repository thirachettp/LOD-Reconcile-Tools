"use client";
import { useState } from "react";
import { reportText, type ReportItem } from "@/lib/report";

export function ReportCard({
  title,
  onTitle,
  items,
  onAdd,
  onRemove,
  onClear,
  canAdd,
}: {
  title: string;
  onTitle: (t: string) => void;
  items: ReportItem[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  canAdd: boolean;
}) {
  const [totals, setTotals] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = reportText(items, totals);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard อาจถูกบล็อก — ผู้ใช้ยังเลือกข้อความในกล่องแล้วคัดลอกเองได้ */
    }
  };

  return (
    <div className="card">
      <div className="card-label">📝 สรุปผลสำหรับรายงาน (คัดลอกไปส่งได้)</div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ flex: 1, minWidth: 220 }} value={title} onChange={(e) => onTitle(e.target.value)} aria-label="ชื่อหัวข้อ" placeholder="ชื่อหัวข้อ เช่น WMS Sprint vs InitialStock" />
        <button className="btn primary" disabled={!canAdd} onClick={onAdd}>
          ➕ เพิ่มผลนี้ในรายงาน
        </button>
      </div>
      {items.length === 0 ? (
        <div className="muted">ตั้งชื่อหัวข้อ แล้วกด “เพิ่มผลนี้ในรายงาน” — Run Compare คู่อื่นต่อแล้วเพิ่มได้อีก จะรวมเป็นรายงานเดียวเรียงเป็นข้อ 1, 2, 3…</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            {items.map((it, i) => (
              <span key={it.id} className="chip">
                {i + 1}. {it.title}
                <button type="button" className="x" aria-label={`ลบ ${it.title}`} onClick={() => onRemove(it.id)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <textarea className="input" readOnly rows={Math.min(24, text.split("\n").length + 1)} style={{ width: "100%", fontFamily: "inherit", lineHeight: 1.5 }} value={text} onFocus={(e) => e.currentTarget.select()} />
          <div className="row" style={{ marginTop: 8 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={totals} onChange={(e) => setTotals(e.target.checked)} />
              แสดงยอดรวม (Rows / ผลรวมแต่ละฝั่ง)
            </label>
            <span className="spacer" />
            <button className="btn small" onClick={onClear}>
              ล้างรายงาน
            </button>
            <button className="btn small primary" onClick={copy}>
              {copied ? "✓ คัดลอกแล้ว" : "📋 คัดลอกข้อความ"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
