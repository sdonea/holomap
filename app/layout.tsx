import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";
import { AgentationProvider } from "@/components/AgentationProvider";

const pixel = VT323({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap" });

const description =
  "A live holotable of the real ocean: today's currents, forecast wind and live ships. Pick two points and it plots the route that burns the least fuel. Built by Sebastian \"Seth\" Donea.";
export const metadata: Metadata = {
  title: "Holomap · live fuel-optimal ship routing",
  description,
  authors: [{ name: 'Sebastian "Seth" Donea' }],
  openGraph: { title: "Holomap", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Holomap", description },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={pixel.variable}>
      <body className="antialiased">
        {children}
        <AgentationProvider />
      </body>
    </html>
  );
}
