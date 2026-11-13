import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const display = Baloo_2({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Nunito({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Talk to a Coding Repo | Big Red",
  description:
    "Paste a GitHub or GitLab link and chat out loud with Pixel the fox, who explains any code project in plain language.",
};

export const viewport: Viewport = { themeColor: "#e11d2e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        {/* The red theme is the design; ask Dark Reader not to recolor it. */}
        <meta name="darkreader-lock" />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <Image src="/avatar.png" alt="" width={40} height={40} className="brand-face" />
            <span>Talk to a Coding Repo</span>
          </Link>
          <span className="topbar-tag">Big Red · Lville</span>
        </header>
        {children}
        <footer className="footer">
          Made for the Lville community. Go Big Red!{" "}
          Pixel reads public code on GitHub and GitLab and explains it in plain language. Pixel can make mistakes, so
          check the real code when it matters.
        </footer>
      </body>
    </html>
  );
}
