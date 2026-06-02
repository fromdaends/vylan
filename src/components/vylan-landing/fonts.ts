// Schibsted Grotesk — the display/body face for the public marketing
// site (landing + manifesto), scoped to those pages via the `.variable`
// className on the page root so it doesn't change the app's Inter UI.
// JetBrains Mono is already loaded app-wide in the locale layout
// (--font-jetbrains-mono), so the landing reuses that for mono accents.
import { Schibsted_Grotesk } from "next/font/google";

export const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});
