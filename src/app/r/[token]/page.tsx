import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter, JetBrains_Mono } from "next/font/google";
import { loadPortalContext } from "@/lib/db/portal";
import { reconcilePaymentRequest } from "@/lib/payments/reconcile";
import { brand } from "@/lib/brand";
import { PortalShell } from "@/components/portal/portal-shell";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { getBrandingImageUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// KEEP CLIENT PORTALS OUT OF SEARCH ENGINES.
//
// This page is one client's tax documents, reachable by anyone holding the
// link — that's the whole design, and it's why the link is private. But
// "private" only held as long as nobody crawled it, and until now nothing
// told a crawler to stay away: no robots meta, no robots.txt.
//
// Leaving it out of the sitemap was never enough. That only stops US
// advertising the URL. A crawler finds it the ways URLs always leak: a client
// pastes it into a forum asking for help, a browser extension phones the URL
// home, someone forwards the email into a mailing list that's archived on the
// public web. Any one of those and a client's T4s are in a search index.
//
// noindex is the right tool, and robots.txt is NOT — a Disallow would stop
// crawlers FETCHING the page, which means they'd never read this directive,
// and the bare URL could still surface. So: crawlable, emphatically
// not indexable. See src/app/robots.ts, which deliberately does not
// disallow /r/ for exactly this reason.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

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
  searchParams: Promise<{
    lang?: string;
    paid?: string;
    view?: string;
    paypal?: string;
  }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  const ctx = await loadPortalContext(token);
  if (!ctx) notFound();

  // The client just returned from a successful Stripe checkout (?paid=1).
  // Reconcile the payment straight from Stripe so it flips to "paid" for the
  // accountant immediately, without depending on the webhook.
  if (
    sp.paid === "1" &&
    ctx.payment_request &&
    ctx.firm.stripe_connect_account_id
  ) {
    await reconcilePaymentRequest(
      ctx.payment_request.id,
      ctx.firm.stripe_connect_account_id,
    );
  }

  // The client portal ALWAYS defaults to English, regardless of the client's
  // stored locale or the firm default. The client can switch to French via the
  // in-header ?lang= toggle (portal-shell), but the initial language is English.
  const locale: "fr" | "en" = sp.lang === "fr" ? "fr" : "en";
  const [messages, firmLogoUrl] = await Promise.all([
    getMessages({ locale }),
    getBrandingImageUrl(ctx.firm.logo_url),
  ]);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <title>{`${brand.name}: ${ctx.firm.name}`}</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <PortalShell
              ctx={ctx}
              locale={locale}
              firmLogoUrl={firmLogoUrl}
              justReturnedPaid={sp.paid === "1"}
              // PayPal capture came back PENDING (eCheck-style) — show the
              // "payment processing" state instead of "due".
              justReturnedProcessing={sp.paypal === "processing"}
              // "You have a new message" email links land straight in the
              // thread (Phase 3 sends them with ?view=messages).
              initialMessagesOpen={sp.view === "messages"}
            />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
