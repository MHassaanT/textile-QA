import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Zarea QA Studio — Textile Inspection", description: "AI-assisted fabric quality inspection powered by Gemma 4." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
