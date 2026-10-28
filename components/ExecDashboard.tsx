"use client";
import { useMemo, useRef, useState } from "react";
import { buildExecHtml, type ExecPair } from "@/lib/email-html";

/** Dashboard สรุปทุกคู่ — HTML แบบ inline-style ที่คัดลอกไปวางในอีเมล (Outlook / Gmail) ได้ตรง ๆ */
export function ExecDashboard({ pairs, plainText }: { pairs: ExecPair[]; plainText: string }) {
  const [heading, setHeading] = useState("สรุปผลการ Reconcile Stock");
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => buildExecHtml(pairs, { heading }), [pairs, heading]);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(null), 2500);
  };

  const copyRich = async () => {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
        return flash("✓ คัดลอกแล้ว — ไปวาง (Ctrl+V) ในอีเมลได้เลย");
      }
      throw new Error("no ClipboardItem");
    } catch {
      // วิธีสำรอง: เลือกเนื้อหาที่แสดงอยู่แล้วสั่งคัดลอก
      const el = ref.current;
      if (!el) return;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
      const ok = document.execCommand("copy");
      sel?.removeAllRanges();
      flash(ok ? "✓ คัดลอกแล้ว — ไปวาง (Ctrl+V) ในอีเมลได้เลย" : "คัดลอกอัตโนมัติไม่ได้ — ลากเลือก Dashboard แล้วกด Ctrl+C");
    }
  };

  const downloadHtml = () => {
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${heading.replace(/</g, "&lt;")}</title></head><body style="margin:0;padding:16px;background:#fff;">${html}</body></html>`;
    const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    a.href = url;
    a.download = `Reconcile_Dashboard_${p2(d.getDate())}${p2(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="row" style={{ gap: 6, flex: 1, minWidth: 260 }}>
          <span className="muted">หัวเรื่อง</span>
          <input className="input" style={{ flex: 1 }} value={heading} onChange={(e) => setHeading(e.target.value)} aria-label="หัวเรื่อง Dashboard" />
        </label>
        <button className="btn primary" onClick={copyRich}>
          📧 คัดลอก Dashboard ไปวางในอีเมล
        </button>
        <button className="btn" onClick={downloadHtml}>
          ⬇️ ดาวน์โหลด .html
        </button>
      </div>
      {msg && <div className="badge ok" style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="exec-wrap">
        <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
