import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";
import { AgentationProvider } from "@/components/AgentationProvider";

const pixel = VT323({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap" });

export const metadata: Metadata = {
  title: "Holomap",
  description: "Live ocean currents on a Carrier Command 2 style holotable.",
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
