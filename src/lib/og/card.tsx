import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { brand } from "@/lib/brand";
import { assertLocale } from "@/lib/locale";
import { type AppLocale } from "@/i18n/routing";

/**
 * The shared social-share card — the picture that appears when a vylan.app link
 * is posted to X, LinkedIn, Slack, iMessage, WhatsApp, Discord, etc.
 *
 * 1200x630 is the size every platform agrees on. X renders it as the large
 * `summary_large_image` card; anything much smaller gets demoted to the little
 * square thumbnail instead, which is the exact thing we're trying to avoid.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * Card copy, kept here rather than in messages/*.json ON PURPOSE.
 *
 * This is art copy baked into a PNG, not UI text: it has to stay short enough
 * to stay legible when X shrinks the card to a thumbnail in a crowded timeline,
 * which is a tighter constraint than any on-page string. Both lines are lifted
 * verbatim from copy that is already public (brand.tagline and the landing
 * page's meta_title), so nothing new is being said here.
 *
 * To reword the card, edit SUBLINE below and brand.tagline in src/lib/brand.ts.
 */
const SUBLINE: Record<AppLocale, string> = {
  en: "Document collection for accounting firms",
  fr: "Collecte de documents pour cabinets comptables",
};

/**
 * Font bytes for satori (the renderer behind ImageResponse).
 *
 * `new URL(..., import.meta.url)` is the pattern Next documents for this, and
 * it matters: it is statically analysable, so the bundler emits the .ttf as a
 * traced asset and it survives into the serverless bundle. A plain
 * `join(process.cwd(), ...)` would read fine locally and 404 in production,
 * because public/ is served by the CDN and never lands in the function.
 *
 * satori cannot read woff2, which is what Google Fonts serves to modern
 * browsers — these are the .ttf builds, committed under src/lib/og/fonts/.
 */
async function loadFonts() {
  const [semibold, regular] = await Promise.all([
    readFile(new URL("./fonts/SchibstedGrotesk-SemiBold.ttf", import.meta.url)),
    readFile(new URL("./fonts/SchibstedGrotesk-Regular.ttf", import.meta.url)),
  ]);
  return [
    { name: "Schibsted Grotesk", data: semibold, weight: 600 as const, style: "normal" as const },
    { name: "Schibsted Grotesk", data: regular, weight: 400 as const, style: "normal" as const },
  ];
}

/**
 * The folded "V" mark, redrawn as inline SVG rather than loading
 * public/vylan-logo-white.png.
 *
 * Same geometry as public/logo-light.svg (a single stroked path through
 * 72,76 -> 128,178 -> 184,76 at stroke-width 52), split into two half-strokes
 * so the two faces of the fold can take different whites. The original gets its
 * two tones from a clipPath over one path; satori's clipPath support is thin,
 * and two paths render identically here because the round caps meet at the
 * bottom vertex exactly where the round join used to be. The right face is
 * drawn first so the brighter left face sits on top at the fold, matching the
 * real mark.
 */
function Mark({ height }: { height: number }) {
  // Cropped to the mark's true ink bounds instead of the source file's square
  // 0 0 256 256 canvas. The stroked V only occupies x 46-210 / y 50-204 of that
  // canvas (the path spans 72-184 wide, plus the 26px half-stroke and its round
  // caps), so the original viewBox is ~36% empty padding — which shrinks the
  // logo to a stamp at any given box size. Cropping lets `height` mean the
  // height of the visible mark.
  const ratio = 164 / 154;
  return (
    <svg width={Math.round(height * ratio)} height={height} viewBox="46 50 164 154" fill="none">
      <g strokeWidth={52} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M128 178 L184 76" stroke="#ffffff" strokeOpacity={0.62} />
        <path d="M72 76 L128 178" stroke="#ffffff" />
      </g>
    </svg>
  );
}

/**
 * Renders the share card for one locale. Both the Open Graph route and the
 * Twitter route call this so the two images can never drift apart.
 */
export async function renderShareCard(locale: string): Promise<ImageResponse> {
  const lang = assertLocale(locale);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "76px 84px",
          backgroundColor: "#1050ed",
          // A soft off-centre highlight so the flat blue reads as a lit surface
          // rather than a colour swatch. Mirrors the depth on the landing hero.
          backgroundImage:
            "radial-gradient(1100px 620px at 78% 12%, rgba(255,255,255,0.16), rgba(255,255,255,0) 62%)",
          color: "#ffffff",
          fontFamily: "Schibsted Grotesk",
        }}
      >
        {/* Lockup: big mark + wordmark, set like the site's own .vy-brand
            (weight 600 at -0.055em tracking). */}
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <Mark height={168} />
          <div
            style={{
              display: "flex",
              fontSize: 128,
              fontWeight: 600,
              letterSpacing: "-0.055em",
              lineHeight: 1,
            }}
          >
            {brand.name.toLowerCase()}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
            }}
          >
            {brand.tagline[lang]}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 34,
              fontWeight: 400,
              letterSpacing: "-0.01em",
              color: "rgba(255,255,255,0.78)",
            }}
          >
            {SUBLINE[lang]}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "rgba(255,255,255,0.72)",
          }}
        >
          <div style={{ display: "flex", width: 44, height: 3, backgroundColor: "rgba(255,255,255,0.42)" }} />
          {brand.domain}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts() },
  );
}
