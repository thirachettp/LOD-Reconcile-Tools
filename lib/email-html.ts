import type { CompareSummary } from "./types";

/** ข้อมูลของหนึ่งคู่สำหรับ Dashboard ส่งผู้บริหาร */
export interface ExecPair {
  title: string;
  sideA: string;
  sideB: string;
  keys: string[];
  fields: string[];
  summary: CompareSummary;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n0 = (x: number) => x.toLocaleString("en-US");
const n2 = (x: number | null) => (x === null ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const rate = (m: number, t: number) => (t ? (m / t) * 100 : 0);

const C = { navy: "#1e293b", ink: "#0f172a", mute: "#64748b", line: "#e2e8f0", ok: "#15803d", okBg: "#dcfce7", bad: "#b91c1c", badBg: "#fee2e2", warn: "#b45309", warnBg: "#fef3c7", bg: "#f8fafc" };
const FONT = "font-family:'Segoe UI',Tahoma,'Noto Sans Thai',Arial,sans-serif;";

const pill = (ok: boolean) =>
  `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${ok ? C.okBg : C.badBg};color:${ok ? C.ok : C.bad};">${ok ? "Match" : "Not Match"}</span>`;

/** แท่งสัดส่วน — ใช้ตารางล้วนเพื่อให้ Outlook/Gmail แสดงผล */
function bar(pct: number, width = "100%"): string {
  const p = Math.max(0, Math.min(100, pct));
  const color = p >= 99.995 ? "#16a34a" : p >= 90 ? "#d97706" : "#dc2626";
  const left = `<td width="${p.toFixed(2)}%" bgcolor="${color}" style="background:${color};height:8px;font-size:0;line-height:0;">&nbsp;</td>`;
  const right = p < 100 ? `<td bgcolor="#e2e8f0" style="background:#e2e8f0;height:8px;font-size:0;line-height:0;">&nbsp;</td>` : "";
  return `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-radius:4px;"><tr>${p > 0 ? left : ""}${right || (p === 0 ? `<td bgcolor="#e2e8f0" style="background:#e2e8f0;height:8px;">&nbsp;</td>` : "")}</tr></table>`;
}

const th = (t: string, align = "right") => `<th align="${align}" style="padding:6px 8px;font-size:11px;color:${C.mute};text-transform:uppercase;border-bottom:1px solid ${C.line};text-align:${align};">${t}</th>`;
const td = (t: string, align = "right", extra = "") => `<td align="${align}" style="padding:6px 8px;font-size:13px;color:${C.ink};border-bottom:1px solid ${C.line};text-align:${align};${extra}">${t}</td>`;

function tile(label: string, value: string, color: string): string {
  return `<td width="25%" align="center" style="padding:12px 6px;background:#fff;border:1px solid ${C.line};"><div style="font-size:24px;font-weight:700;color:${color};">${value}</div><div style="font-size:11px;color:${C.mute};text-transform:uppercase;letter-spacing:.05em;">${label}</div></td>`;
}

export function buildExecHtml(pairs: ExecPair[], opts: { heading?: string; date?: string } = {}): string {
  const heading = opts.heading || "สรุปผลการ Reconcile Stock";
  const date = opts.date ?? new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  const okOf = (p: ExecPair) => p.summary.mismatch + p.summary.missingA + p.summary.missingB === 0;
  const passed = pairs.filter(okOf).length;
  const sumTotal = pairs.reduce((a, p) => a + p.summary.total, 0);
  const sumMatch = pairs.reduce((a, p) => a + p.summary.match, 0);
  const overall = rate(sumMatch, sumTotal);

  const head = `<tr><td style="background:${C.navy};padding:18px 22px;"><div style="font-size:20px;font-weight:700;color:#fff;">${esc(heading)}</div><div style="font-size:12px;color:#cbd5e1;margin-top:2px;">ข้อมูล ณ ${esc(date)} · ${pairs.length} คู่</div></td></tr>`;

  const tiles = `<tr><td style="padding:14px 14px 4px;background:${C.bg};"><table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;"><tr>${tile("คู่ที่เทียบ", n0(pairs.length), C.ink)}${tile("Match", n0(passed), C.ok)}${tile("Not Match", n0(pairs.length - passed), pairs.length - passed ? C.bad : C.mute)}${tile("Match Rate รวม", `${overall.toFixed(2)}%`, overall >= 99.995 ? C.ok : C.warn)}</tr></table></td></tr>`;

  const overviewRows = pairs
    .map((p, i) => {
      const s = p.summary;
      const r = rate(s.match, s.total);
      return `<tr>${td(String(i + 1), "left")}${td(`<strong>${esc(p.title)}</strong>`, "left")}${td(n0(s.total))}${td(n0(s.mismatch), "right", s.mismatch ? `color:${C.warn};font-weight:700;` : "")}${td(n0(s.missingA), "right", s.missingA ? `color:${C.bad};font-weight:700;` : "")}${td(n0(s.missingB), "right", s.missingB ? `color:${C.bad};font-weight:700;` : "")}${td(`<div style="margin-bottom:3px;">${r.toFixed(2)}%</div>${bar(r, "90px")}`, "right")}${td(pill(okOf(p)), "center")}</tr>`;
    })
    .join("");
  const overview = `<tr><td style="padding:10px 14px 4px;background:${C.bg};"><div style="font-size:14px;font-weight:700;color:${C.ink};margin:6px 0;">ภาพรวมทุกคู่</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#fff;border:1px solid ${C.line};"><tr>${th("#", "left")}${th("คู่ที่เทียบ", "left")}${th("Total Key")}${th("Mismatch")}${th("Missing A")}${th("Missing B")}${th("Match %")}${th("Status", "center")}</tr>${overviewRows}</table></td></tr>`;

  const details = pairs
    .map((p, i) => {
      const s = p.summary;
      const ok = okOf(p);
      const r = rate(s.match, s.total);
      const fieldRows = [
        `<tr>${td("Rows", "left")}${td(n0(s.rowsA))}${td(n0(s.rowsB))}${td(n0(s.rowsA - s.rowsB), "right", s.rowsA === s.rowsB ? `color:${C.mute};` : `color:${C.warn};font-weight:700;`)}${td(s.rowsA ? `${((s.rowsB / s.rowsA) * 100).toFixed(2)}%` : "-")}${td("-")}</tr>`,
        ...s.perField.map((f) => {
          const isNum = f.kind === "number";
          const d = isNum && f.sumA !== null && f.sumB !== null ? f.sumA - f.sumB : null;
          const dStyle = f.rowsDiff === 0 ? `color:${C.mute};` : `color:${C.warn};font-weight:700;`;
          return `<tr>${td(esc(f.name), "left")}${td(isNum ? n2(f.sumA) : "-")}${td(isNum ? n2(f.sumB) : "-")}${td(isNum ? (d === null ? "-" : n2(d)) : f.kind === "date" ? `${n2(f.totalAbsDiff)} วัน` : "-", "right", dStyle)}${td(isNum && f.sumA ? `${(((f.sumB ?? 0) / f.sumA) * 100).toFixed(2)}%` : "-")}${td(f.rowsDiff === 0 ? "ตรงทั้งหมด" : `${n0(f.rowsDiff)} แถวต่าง`, "right", f.rowsDiff === 0 ? `color:${C.ok};` : `color:${C.warn};font-weight:700;`)}</tr>`;
        }),
      ].join("");
      return `<tr><td style="padding:10px 14px 4px;background:${C.bg};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#fff;border:1px solid ${C.line};border-left:4px solid ${ok ? "#16a34a" : "#dc2626"};"><tr><td style="padding:12px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:15px;font-weight:700;color:${C.ink};">${i + 1}. ${esc(p.title)}</td><td align="right">${pill(ok)}</td></tr></table>
<div style="font-size:12px;color:${C.mute};margin:4px 0;">A: ${esc(p.sideA)} &nbsp;|&nbsp; B: ${esc(p.sideB)}</div>
<div style="font-size:12px;color:${C.ink};">Keys : ${esc(p.keys.join(", "))}</div>
<div style="font-size:12px;color:${C.ink};margin-bottom:8px;">Compare : ${esc(p.fields.join(", ") || "-")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;"><tr><td style="font-size:12px;color:${C.mute};">Match ${n0(s.match)} จาก ${n0(s.total)} Key</td><td align="right" style="font-size:12px;font-weight:700;color:${C.ink};">${r.toFixed(2)}%</td></tr></table>
${bar(r)}
<div style="font-size:12px;margin:8px 0;color:${C.ink};">Mismatch <strong style="color:${s.mismatch ? C.warn : C.mute};">${n0(s.mismatch)}</strong> &nbsp;·&nbsp; Missing A <strong style="color:${s.missingA ? C.bad : C.mute};">${n0(s.missingA)}</strong> &nbsp;·&nbsp; Missing B <strong style="color:${s.missingB ? C.bad : C.mute};">${n0(s.missingB)}</strong></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${th("ฟิลด์", "left")}${th("A รวม")}${th("B รวม")}${th("ผลต่าง (A−B)")}${th("B ÷ A")}${th("ผลการเทียบ")}</tr>${fieldRows}</table>
</td></tr></table></td></tr>`;
    })
    .join("");

  const foot = `<tr><td style="padding:10px 22px 16px;background:${C.bg};font-size:11px;color:${C.mute};">สร้างจาก LOD · Reconcile Tools — Match % = จำนวน Key ที่ตรงทั้งหมด ÷ จำนวน Key ทั้งหมด · B ÷ A = ยอดรวมฝั่ง B เทียบกับฝั่ง A</td></tr>`;

  return `<table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:720px;max-width:100%;border-collapse:collapse;${FONT}background:${C.bg};">${head}${tiles}${overview}${details}${foot}</table>`;
}
