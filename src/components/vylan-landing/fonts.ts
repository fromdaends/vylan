// Schibsted Grotesk — the display/body face for the public marketing
// site (landing + manifesto), scoped to those pages via the `.variable`
// className on the page root so it doesn't change the app's Inter UI.
// JetBrains Mono is already loaded app-wide in the locale layout
// (--font-jetbrains-mono), so the landing reuses that for mono accents.
import {
  Schibsted_Grotesk,
  Poppins,
  Quicksand,
  Nunito_Sans,
} from "next/font/google";

export const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

// Wordmark faces for the /how-it-works integrations marquee ONLY — each
// third-party name is set in a face that evokes its real logotype (per the
// "Vylan What We Do" design). Weight-trimmed to exactly what the marquee uses.
export const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
export const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});
export const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});
