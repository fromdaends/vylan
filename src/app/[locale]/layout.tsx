import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";
import { siteUrl } from "@/lib/site-url";
import { socialMetadata } from "@/lib/og/metadata";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Suspense } from "react";
import { RouteProgress } from "@/components/app/route-progress";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

// Language-aware fallback title/description for every page that doesn't set
// its own metadata (the whole signed-in app + the auth pages). English is the
// default locale, so an unprefixed fresh load reads English in the browser tab;
// a visitor who explicitly picked French (the /fr prefix) gets the French tab
// title. Marketing pages (home, how-it-works, contact) already localize their
// own titles via their page-level generateMetadata, so this only governs the
// pages that previously inherited the hardcoded French tagline.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const tagline = hasLocale(routing.locales, locale)
    ? brand.tagline[locale]
    : brand.tagline[routing.defaultLocale];
  const title = `${brand.name}: ${tagline}`;
  return {
    // metadataBase turns every relative metadata url — crucially the generated
    // opengraph-image — into an absolute one. Social crawlers fetch og:image
    // from their own servers, so a relative "/opengraph-image" is simply
    // dropped and the link renders as a bare blue text link with no picture.
    // Without this line the rest of the card setup does nothing.
    metadataBase: new URL(siteUrl()),
    title,
    description: tagline,
    // Site-wide share-card defaults. Pages that want their own headline on the
    // card call socialMetadata() themselves; everything else inherits these, so
    // any public vylan.app url previews rather than only the ones we remembered
    // to annotate.
    ...socialMetadata({ locale, title, description: tagline }),
  };
}

// viewport-fit=cover is what makes env(safe-area-inset-*) resolve to real
// values on notched iPhones (iOS Safari/Chrome). Without it the mobile bottom
// tab bar + help FAB ignore the home-indicator inset and sit flush/overlapping.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          {/* The page-loading hairline, mounted once for the WHOLE site —
              marketing pages and the signed-in app both. It reads the URL to
              know when a navigation finished, and useSearchParams() would opt
              every page into client rendering without this Suspense boundary;
              inside one, only the bar waits. */}
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
