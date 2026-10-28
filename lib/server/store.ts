import { promises as fs } from "node:fs";
import type { SavedMapping } from "../library";
import type { TemplateStore } from "./templates";

const HASH = "lod:templates:v1";

/** Redis REST (Upstash / Vercel KV) — ใช้ fetch ตรง ไม่ต้องติดตั้ง SDK */
function redisStore(url: string, token: string): TemplateStore {
  const cmd = async (args: (string | number)[]): Promise<unknown> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !j || j.error) throw new Error(`ที่เก็บข้อมูลของทีมตอบผิดพลาด (${j?.error ?? res.status})`);
    return j.result;
  };
  return {
    async all() {
      const flat = ((await cmd(["HGETALL", HASH])) as string[] | null) ?? [];
      const out: SavedMapping[] = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          out.push(JSON.parse(flat[i]) as SavedMapping);
        } catch {
          /* ข้ามรายการที่เสีย */
        }
      }
      return out;
    },
    async put(item) {
      await cmd(["HSET", HASH, item.id, JSON.stringify(item)]);
    },
    async del(id) {
      await cmd(["HDEL", HASH, id]);
    },
  };
}

/** ไฟล์ JSON — ใช้ทดสอบในเครื่องเท่านั้น (บน Vercel ไฟล์ไม่คงอยู่) */
function fileStore(path: string): TemplateStore {
  const read = async (): Promise<Record<string, SavedMapping>> => {
    try {
      return JSON.parse(await fs.readFile(path, "utf8"));
    } catch {
      return {};
    }
  };
  return {
    async all() {
      return Object.values(await read());
    },
    async put(item) {
      const m = await read();
      m[item.id] = item;
      await fs.writeFile(path, JSON.stringify(m));
    },
    async del(id) {
      const m = await read();
      delete m[id];
      await fs.writeFile(path, JSON.stringify(m));
    },
  };
}

export function getStore(env: NodeJS.ProcessEnv = process.env): TemplateStore | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return redisStore(url, token);
  if (env.TEMPLATE_STORE_FILE && env.NODE_ENV !== "production") return fileStore(env.TEMPLATE_STORE_FILE);
  return null;
}
