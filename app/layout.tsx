import type { Metadata, Viewport } from "next";
import { Lora, DM_Sans } from "next/font/google";
import "./globals.css";
import { MeshBackground } from "@/app/components/mesh-background";
import { MonitorNav } from "@/app/components/monitor-nav";

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Enricher Agent",
  description: "Enrich company and people data with Claude AI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${lora.variable} ${dmSans.variable} h-full`}>
      <body className="min-h-full overflow-x-hidden">
        <MeshBackground />
        <MonitorNav />
        {children}
      </body>
    </html>
  );
}
