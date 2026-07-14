import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";
import { ThemeProvider } from "@/components/theme/theme-provider";

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
  return {
    title: `${brand.name}: ${tagline}`,
    description: tagline,
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
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
