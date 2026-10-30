import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";
import { AgentationProvider } from "@/components/AgentationProvider";
import { Analytics } from "@vercel/analytics/next";
import { preload } from "react-dom";

const pixel = VT323({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap" });

const description =
  "A live holotable of the real ocean: today's currents, forecast wind and live ships. Pick two points and it plots the route that burns the least fuel. Built by Sebastian \"Seth\" Donea.";
export const metadata: Metadata = {
  metadataBase: new URL("https://holomap.app"),
  alternates: { canonical: "/" },
  title: "Holomap · live fuel-optimal ship routing",
  description,
  authors: [{ name: 'Sebastian "Seth" Donea' }],
  openGraph: { title: "Holomap", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Holomap", description },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Start the ~1 MB current grid with the HTML instead of after the JS runs; lib/currents.ts picks it up.
  preload("/api/currents", { as: "fetch", crossOrigin: "anonymous" });
  return (
    <html lang="en" className={pixel.variable}>
      <body className="antialiased">
        {children}
        <AgentationProvider />
        <Analytics />
      </body>
    </html>
  );
}
