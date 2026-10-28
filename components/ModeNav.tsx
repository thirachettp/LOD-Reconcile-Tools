"use client";
import Link from "next/link";

/** สลับโหมด: เทียบ 2 ชุด / เทียบหลายชุด */
export function ModeNav({ mode }: { mode: "single" | "multi" }) {
  return (
    <nav className="seg mode-nav" aria-label="โหมดการเทียบ">
      <Link href="/" className={mode === "single" ? "on" : ""} aria-current={mode === "single" ? "page" : undefined}>
        เทียบ 2 ชุด
      </Link>
      <Link href="/multi" className={mode === "multi" ? "on" : ""} aria-current={mode === "multi" ? "page" : undefined} title="อัปโหลดครั้งเดียว เทียบหลายคู่ เช่น A=B และ B=C">
        เทียบหลายชุด
      </Link>
    </nav>
  );
}
