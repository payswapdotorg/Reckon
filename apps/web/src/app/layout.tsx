import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Reckon Studio",
    template: "%s — Reckon Studio",
  },
  description:
    "Reckon Studio — the decision engine for what to show, say, play, recommend, buy, or interrupt, and when.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
