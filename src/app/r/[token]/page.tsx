import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter, JetBrains_Mono } from "next/font/google";
import { loadPortalContext } from "@/lib/db/portal";
import { brand } from "@/lib/brand";
import { PortalShell } from "@/components/portal/portal-shell";
import { getBrandingImageUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  const ctx = await loadPortalContext(token);
  if (!ctx) notFound();

  const locale: "fr" | "en" =
    sp.lang === "en"
      ? "en"
      : sp.lang === "fr"
        ? "fr"
        : ctx.client.locale;
  const [messages, firmLogoUrl] = await Promise.all([
    getMessages({ locale }),
    getBrandingImageUrl(ctx.firm.logo_url),
  ]);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <title>{`${brand.name} — ${ctx.firm.name}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PortalShell ctx={ctx} locale={locale} firmLogoUrl={firmLogoUrl} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
