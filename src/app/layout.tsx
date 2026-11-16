import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { assertRuntimeConfiguration } from "@/lib/runtime/env";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "NEXORA Business OS",
  description: "Run your business. Build better.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  assertRuntimeConfiguration();

  return (
    <html lang="nl">
      <body className={`${manrope.variable} ${fraunces.variable} font-sans`}>{children}</body>
    </html>
  );
}
