import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { getLang } from "@/lib/i18n";
import { site } from "@/lib/site";
import "./globals.css";

// next/font downloads these at build time and serves them from our own address,
// so pages make no request to Google. globals.css turns the variables into Tailwind classes.
// Archivo is loaded with its width axis, so the same file gives the wide headline cut and the body text.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: "%s | QuizoTab" },
  description: site.description,
  openGraph: { type: "website", siteName: site.name, title: "QuizoTab | Host live quiz tournaments", description: site.description },
};

export const viewport: Viewport = {
  themeColor: "#15171C",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${archivo.variable} ${jetbrains.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
