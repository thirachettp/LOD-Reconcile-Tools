"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { SavedMapping } from "./library";
import type { MappingRow, SystemCode } from "./types";

/**
 * คลัง Template ของทีม (เก็บบนเซิร์ฟเวอร์ ผ่าน /api/templates)
 * - สถานะใช้ร่วมกันทั้งหน้า (หลาย component อ่านชุดเดียวกัน ไม่ยิง API ซ้ำ)
 * - รหัสผ่านทีมเก็บในเบราว์เซอร์นี้ (localStorage) แล้วส่งเป็น header ทุกครั้ง
 */
export type TeamState = "unknown" | "loading" | "off" | "locked" | "ready" | "error";

export interface TeamSnapshot {
  state: TeamState;
  items: SavedMapping[];
  message?: string;
}

const PASS_KEY = "lod-reconcile:team-passcode";
const AUTHOR_KEY = "lod-reconcile:team-author";

let snap: TeamSnapshot = { state: "unknown", items: [] };
const listeners = new Set<() => void>();
const set = (next: TeamSnapshot) => {
  snap = next;
  listeners.forEach((l) => l());
};

const readLS = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const writeLS = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* ไม่เป็นไร */
  }
};

export const getAuthor = () => readLS(AUTHOR_KEY);
export const setAuthor = (n: string) => writeLS(AUTHOR_KEY, n.trim().slice(0, 40));

interface Resp {
  status: number;
  json: { items?: SavedMapping[]; item?: SavedMapping; error?: string; message?: string; existingId?: string } | null;
}

async function api(method: string, query: string, body?: unknown, pass = readLS(PASS_KEY)): Promise<Resp> {
  const res = await fetch(`/api/templates${query}`, {
    method,
    headers: { "content-type": "application/json", "x-team-passcode": pass },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let json: Resp["json"] = null;
  try {
    json = await res.json();
  } catch {
    /* ไม่ใช่ JSON */
  }
  return { status: res.status, json };
}

function applyList(r: Resp) {
  if (r.status === 200 && r.json?.items) set({ state: "ready", items: r.json.items });
  else if (r.status === 401) set({ state: "locked", items: [], message: r.json?.message });
  else if (r.status === 503 || r.status === 404) set({ state: "off", items: [], message: r.json?.message });
  else set({ state: "error", items: snap.items, message: r.json?.message ?? `เชื่อมต่อคลังทีมไม่สำเร็จ (${r.status})` });
}

export async function refreshTeam(): Promise<void> {
  if (snap.state === "unknown") set({ ...snap, state: "loading" });
  try {
    applyList(await api("GET", ""));
  } catch {
    set({ state: "error", items: snap.items, message: "เชื่อมต่อคลังทีมไม่สำเร็จ (ออฟไลน์?)" });
  }
}

/** ใส่รหัสผ่านทีม — คืนข้อความผิดพลาด หรือ null ถ้าสำเร็จ */
export async function unlockTeam(pass: string): Promise<string | null> {
  try {
    const r = await api("GET", "", undefined, pass.trim());
    if (r.status === 200 && r.json?.items) {
      writeLS(PASS_KEY, pass.trim());
      set({ state: "ready", items: r.json.items });
      return null;
    }
    applyList(r);
    return r.json?.message ?? "เชื่อมต่อไม่สำเร็จ";
  } catch {
    return "เชื่อมต่อคลังทีมไม่สำเร็จ (ออฟไลน์?)";
  }
}

export function lockTeam(): void {
  writeLS(PASS_KEY, "");
  set({ state: "locked", items: [] });
}

export type TeamSaveResult =
  | { ok: true; item: SavedMapping }
  | { ok: false; error: string; taken?: boolean; conflict?: boolean; gone?: boolean };

async function mutate(method: string, query: string, body: unknown): Promise<TeamSaveResult> {
  try {
    const r = await api(method, query, body);
    if (r.status === 200 && r.json?.item) {
      void refreshTeam();
      return { ok: true, item: r.json.item };
    }
    if (r.status === 401) set({ state: "locked", items: [], message: r.json?.message });
    return {
      ok: false,
      error: r.json?.message ?? `บันทึกไม่สำเร็จ (${r.status})`,
      taken: r.json?.error === "name_taken",
      conflict: r.json?.error === "conflict",
      gone: r.json?.error === "gone",
    };
  } catch {
    return { ok: false, error: "บันทึกไม่สำเร็จ — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" };
  }
}

export interface TeamSaveInput {
  id?: string;
  name: string;
  sysA: SystemCode;
  sysB: SystemCode;
  rows: MappingRow[];
  compareKeys?: string[];
  compareFields?: string[];
  overwrite?: boolean;
  expectedUpdatedAt?: number;
}

export const teamSave = (i: TeamSaveInput) => mutate("PUT", "", { ...i, author: getAuthor() });
export const teamRename = (id: string, name: string, expectedUpdatedAt?: number) => mutate("PATCH", "", { id, name, expectedUpdatedAt, author: getAuthor() });
export async function teamDelete(id: string): Promise<string | null> {
  try {
    const r = await api("DELETE", `?id=${encodeURIComponent(id)}`);
    if (r.status === 200) {
      void refreshTeam();
      return null;
    }
    return r.json?.message ?? `ลบไม่สำเร็จ (${r.status})`;
  } catch {
    return "ลบไม่สำเร็จ — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const SERVER: TeamSnapshot = { state: "unknown", items: [] };

/** อ่านสถานะคลังทีม — โหลดครั้งแรกอัตโนมัติ และรีเฟรชเมื่อกลับมาที่แท็บ (เห็นของที่เพื่อนร่วมทีมเพิ่งบันทึก) */
export function useTeam(): TeamSnapshot {
  const s = useSyncExternalStore(subscribe, () => snap, () => SERVER);
  useEffect(() => {
    if (snap.state === "unknown") void refreshTeam();
    const onFocus = () => {
      if (snap.state === "ready") void refreshTeam();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return s;
}
