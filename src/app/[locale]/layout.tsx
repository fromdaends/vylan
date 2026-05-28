import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";
import { ThemeProvider } from "@/components/theme/theme-provider";
import {
  AccentProvider,
  ACCENT_NO_FLASH_SCRIPT,
} from "@/components/theme/accent-provider";

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

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.tagline.fr}`,
  description: brand.tagline.fr,
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
        {/* Applies the saved accent to <html data-accent> before first paint
            so there's no flash of the wrong accent. Mode is handled by
            next-themes' own pre-paint script. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_NO_FLASH_SCRIPT }} />
        <ThemeProvider>
          <AccentProvider>
            <NextIntlClientProvider>{children}</NextIntlClientProvider>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
