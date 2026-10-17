import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";

export const serif = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--font-serif", display: "swap" });
export const sans = Manrope({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
export const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono", display: "swap" });
