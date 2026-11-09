import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { assertDemoModeAllowed } from "@/lib/demo/mode";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
});

export const metadata: Metadata = {
  title: "NEXORA Business OS",
  description: "Run your business. Build better.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  assertDemoModeAllowed();

  return (
    <html lang="nl" className="dark">
      <body className={`${ibmPlexSans.variable} font-sans`}>{children}</body>
    </html>
  );
}
