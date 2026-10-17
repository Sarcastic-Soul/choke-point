import type { Metadata } from "next";
import { mono, sans, serif } from "@/lib/fonts";
import "./globals.css";

const TITLE = "Choke Point: the one fix that cuts the most attack paths";
const DESCRIPTION =
  "Pick a compromised account, see every route to the crown jewels, and find the one link to cut. Choke Point drafts the fix ticket from a FalkorDB graph.";

// Needed so the share image gets a full URL. Vercel sets the first variable on deployments.
const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Choke Point",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "33 attack paths cut down to 3 by one fix" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
