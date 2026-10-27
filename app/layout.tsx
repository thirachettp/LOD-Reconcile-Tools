import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LOD - Reconcile Tools",
  description: "เทียบข้อมูลสต็อกระหว่างระบบ FC · JDA · MHT — ประมวลผลในเบราว์เซอร์ ข้อมูลไม่ออกจากเครื่อง",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
