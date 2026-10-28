import type { CompareSummary } from "@/lib/types";

const fmt = (x: number | null, d = 2) => (x === null ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: d }));
const KIND = { number: "ตัวเลข", date: "วันที่", text: "ข้อความ" } as const;

/** ผลต่างต่อฟิลด์ — การ์ดต่อฟิลด์ (ยอดรวม A/B, ผลต่าง, จำนวนแถวที่ต่าง) */
export function FieldCards({ summary, labelA = "A", labelB = "B" }: { summary: CompareSummary; labelA?: string; labelB?: string }) {
  if (!summary.perField.length) return null;
  const total = summary.total;
  return (
    <div className="fcards" aria-label="ผลต่างต่อฟิลด์">
      {summary.perField.map((f) => {
        const ok = f.rowsDiff === 0;
        const okPct = total ? ((total - Math.min(f.rowsDiff, total)) / total) * 100 : 100;
        const diff = f.sumA !== null && f.sumB !== null ? f.sumA - f.sumB : null;
        return (
          <div className={`fcard ${ok ? "ok" : "bad"}`} key={f.name}>
            <div className="fcard-h">
              <span className="fcard-name" title={f.name}>{f.name}</span>
              <span className="fcard-kind">{KIND[f.kind]}</span>
              <span className={`badge ${ok ? "ok" : "warn"}`}>{ok ? "ตรงทั้งหมด" : `ต่าง ${f.rowsDiff.toLocaleString()} แถว`}</span>
            </div>
            {f.kind === "number" ? (
              <div className="fcard-grid">
                <div><div className="fcard-l">{labelA} รวม</div><div className="fcard-v">{fmt(f.sumA)}</div></div>
                <div><div className="fcard-l">{labelB} รวม</div><div className="fcard-v">{fmt(f.sumB)}</div></div>
                <div><div className="fcard-l">ผลต่าง A−B</div><div className={`fcard-v ${diff ? "neg" : "muted"}`}>{diff === null ? "-" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}</div></div>
                <div><div className="fcard-l">B ÷ A</div><div className="fcard-v">{f.sumA ? `${((f.sumB ?? 0) / f.sumA * 100).toFixed(2)} %` : "-"}</div></div>
              </div>
            ) : (
              <div className="fcard-grid two">
                <div><div className="fcard-l">แถวที่ต่าง</div><div className={`fcard-v ${ok ? "muted" : "neg"}`}>{f.rowsDiff.toLocaleString()}</div></div>
                <div><div className="fcard-l">{f.kind === "date" ? "Σ|ต่าง| (วัน)" : "เทียบแบบ"}</div><div className="fcard-v">{f.kind === "date" ? fmt(f.totalAbsDiff) : "ตรงตัวอักษร"}</div></div>
              </div>
            )}
            <div className="bar slim" title={`แถวที่ตรง ${okPct.toFixed(1)}%`}><div style={{ width: `${okPct}%` }} /></div>
            <div className="fcard-f">Σ|diff| {fmt(f.totalAbsDiff)} · ตรง {okPct.toFixed(1)}% ของ {total.toLocaleString()} Key</div>
          </div>
        );
      })}
    </div>
  );
}
