import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "KDone",
  description: "AI publishing workspace for Amazon KDP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{ borderBottom: "1px solid #e5e5e5", padding: "0.75rem 1.5rem" }}>
          <nav style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <Link href="/" style={{ fontWeight: 700 }}>
              KDone
            </Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main style={{ padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}