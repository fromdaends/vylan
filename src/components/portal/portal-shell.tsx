"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  ShieldCheck,
  PenLine,
  FileText,
  ChevronLeft,
} from "lucide-react";
import type { PortalContext } from "@/lib/db/portal";
import { ItemCard } from "./item-card";
import { SignatureItemCard } from "./signature-item-card";
import { PaymentDueCard } from "./payment-due-card";
import { PortalHub, type HubCardData } from "./portal-hub";
import { splitPortalItems } from "@/lib/portal/split-items";
import {
  summarizeSignatures,
  summarizeDocuments,
} from "@/lib/portal/group-summary";
import { PortalFooter } from "./portal-footer";
import { ThemeToggle } from "@/components/theme/theme-toggle";

// Which screen the portal is showing. When the engagement has BOTH signatures
// and documents, the landing is the two-card hub and tapping a card drills into
// that group. When it has only one group, that list is shown straight away (no
// hub, no extra tap) and this never leaves its forced value.
type PortalView = "hub" | "signatures" | "documents";

export function PortalShell({
  ctx,
  locale,
  firmLogoUrl,
  justReturnedPaid = false,
}: {
  ctx: PortalContext;
  locale: "fr" | "en";
  firmLogoUrl: string | null;
  // true right after returning from a successful Stripe checkout (?paid=1).
  justReturnedPaid?: boolean;
}) {
  const t = useTranslations("Portal");
  const [items, setItems] = useState(ctx.items);
  const [uploads, setUploads] = useState(ctx.uploaded_count_by_item);
  const [filesByItem, setFilesByItem] = useState(ctx.files_by_item);
  const [view, setView] = useState<PortalView>("hub");

  // Split into the signature group ("To sign") and the document group.
  const { collection: collectionItems, signatures: signatureItems } =
    splitPortalItems(items);
  const hasSignatures = signatureItems.length > 0;
  const hasDocuments = collectionItems.length > 0;
  // The hub only appears when there's genuinely both kinds of work. Otherwise
  // the client goes straight to the one list, exactly as the portal did before.
  const showHub = hasSignatures && hasDocuments;
  const effectiveView: PortalView = showHub
    ? view
    : hasSignatures && !hasDocuments
      ? "signatures"
      : "documents";

  // Progress ring numbers reflect the DOCUMENTS only — signatures carry their
  // own state on their card / in their list. With no signatures this equals the
  // whole checklist, so the long-standing single-list portal is unchanged.
  const docTotal = collectionItems.length;
  const docDone = collectionItems.filter(
    (i) => i.status === "approved" || i.status === "na",
  ).length;
  const docPct = docTotal === 0 ? 0 : Math.round((docDone / docTotal) * 100);
  const docRemaining = docTotal - docDone;

  const signSummary = summarizeSignatures(signatureItems);
  const docSummary = summarizeDocuments(collectionItems);

  const hubCards: HubCardData[] = [
    {
      key: "sign",
      icon: PenLine,
      title: t("sign_section_title"),
      line:
        signSummary.kind === "to_sign"
          ? t("card_sign_to_sign", { count: signSummary.count })
          : signSummary.kind === "in_review"
            ? t("status_in_review")
            : t("card_sign_all_signed"),
      tone:
        signSummary.kind === "to_sign"
          ? "accent"
          : signSummary.kind === "all_signed"
            ? "success"
            : "muted",
      onSelect: () => setView("signatures"),
    },
    {
      key: "documents",
      icon: FileText,
      title: t("documents_section_title"),
      line:
        docSummary.kind === "needs_attention"
          ? t("card_docs_needs_attention", { count: docSummary.count })
          : docSummary.kind === "outstanding"
            ? t("card_docs_progress", {
                done: docSummary.done,
                total: docSummary.total,
              })
            : t("card_docs_all_set"),
      tone:
        docSummary.kind === "needs_attention"
          ? "warning"
          : docSummary.kind === "outstanding"
            ? "accent"
            : "success",
      onSelect: () => setView("documents"),
    },
  ];

  const brand = ctx.firm.brand_color;

  const initials = ctx.firm.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const otherLocale = locale === "fr" ? "en" : "fr";
  const helpSubject = `${ctx.firm.name}: ${ctx.engagement.title}`;
  // Localized via the Portal namespace (follows the portal locale, which
  // defaults to English) instead of a hardcoded FR/EN branch.
  const helpBody = t("help_body", { title: ctx.engagement.title });

  function handleItemUpdated(itemId: string, patch: Partial<(typeof items)[0]>) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    );
  }
  function handleUploaded(
    itemId: string,
    file: { id: string; name: string; mime: string },
  ) {
    setUploads((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
    handleItemUpdated(itemId, { status: "submitted" });
    // Optimistically show the just-sent file in the per-file list as pending.
    setFilesByItem((prev) => ({
      ...prev,
      [itemId]: [
        ...(prev[itemId] ?? []),
        // A just-sent file is in review with no reason yet. No signed storage
        // URL yet (the server signs those on load), so its tile falls back to
        // the render route until the next refresh; its mime drives the tile.
        {
          id: file.id,
          name: file.name,
          status: "pending" as const,
          reason: null,
          mime: file.mime,
          url: null,
        },
      ],
    }));
  }

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Soft, firm-coloured glow behind the top — gives the surface depth in
          both light and dark without a heavy colour band. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72"
        style={{
          background: `radial-gradient(72% 100% at 50% 0%, ${brand}24, transparent 72%)`,
        }}
      />
      {/* Hairline brand accent at the very top. */}
      <div aria-hidden className="h-1 w-full" style={{ background: brand }} />

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {firmLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firmLogoUrl}
                alt={ctx.firm.name}
                className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-border"
              />
            ) : (
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white ring-1 ring-black/10"
                style={{ background: brand }}
                aria-hidden
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                {ctx.firm.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {ctx.engagement.title}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`?lang=${otherLocale}`}
              className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {otherLocale.toUpperCase()}
            </a>
            <ThemeToggle
              className="rounded-full"
              lightLabel={t("theme_light")}
              darkLabel={t("theme_dark")}
            />
          </div>
        </div>
      </header>

      <main className="animate-in-up mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        {ctx.payment_request && (
          <PaymentDueCard
            token={ctx.engagement.magic_token ?? ""}
            paymentRequest={ctx.payment_request}
            firmName={ctx.firm.name}
            locale={locale}
            justReturnedPaid={justReturnedPaid}
          />
        )}
        {effectiveView === "hub" ? (
          <>
            <GreetingSection
              clientName={ctx.client.display_name}
              firmName={ctx.firm.name}
            />
            <PortalHub cards={hubCards} />
          </>
        ) : effectiveView === "signatures" ? (
          <>
            {showHub ? (
              <BackBar
                title={t("sign_section_title")}
                onBack={() => setView("hub")}
              />
            ) : (
              <GreetingSection
                clientName={ctx.client.display_name}
                firmName={ctx.firm.name}
              />
            )}
            <section className="animate-in-stagger space-y-3">
              {signatureItems.map((item) => (
                <SignatureItemCard
                  key={item.id}
                  token={ctx.engagement.magic_token ?? ""}
                  item={item}
                  locale={locale}
                  signatureStatus={
                    ctx.signature_status_by_item[item.id] ?? null
                  }
                />
              ))}
            </section>
          </>
        ) : (
          <>
            {showHub ? (
              <BackBar
                title={t("documents_section_title")}
                onBack={() => setView("hub")}
              />
            ) : (
              <GreetingSection
                clientName={ctx.client.display_name}
                firmName={ctx.firm.name}
              />
            )}
            {docTotal > 0 && (
              <ProgressCard
                done={docDone}
                total={docTotal}
                pct={docPct}
                remaining={docRemaining}
                brand={brand}
                firmName={ctx.firm.name}
              />
            )}
            <section className="animate-in-stagger space-y-3">
              {collectionItems.map((item) => (
                <ItemCard
                  key={item.id}
                  token={ctx.engagement.magic_token ?? ""}
                  item={item}
                  locale={locale}
                  uploadedCount={uploads[item.id] ?? 0}
                  files={filesByItem[item.id] ?? []}
                  rejection={ctx.rejection_summary_by_item[item.id] ?? null}
                  autoRequestMissingPages={Boolean(
                    ctx.firm.auto_request_missing_pages,
                  )}
                  onUploaded={(f) => handleUploaded(item.id, f)}
                  onStatusChange={(status) =>
                    handleItemUpdated(item.id, { status })
                  }
                />
              ))}
            </section>
          </>
        )}

        <PortalFooter
          email={ctx.accountant_email}
          subject={helpSubject}
          body={helpBody}
        />
      </main>
    </div>
  );
}

// The greeting block shown on the hub and on a single-group portal: a warm
// hello, one line of context, and a quiet trust note.
function GreetingSection({
  clientName,
  firmName,
}: {
  clientName: string;
  firmName: string;
}) {
  const t = useTranslations("Portal");
  return (
    <section className="space-y-2.5">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("greeting", { name: clientName })}
      </h1>
      <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
        {t("subhead", { firm: firmName })}
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        {t("trust", { firm: firmName })}
      </p>
    </section>
  );
}

// A back link + title shown atop a drill-in view, so the client can always
// return to the two-card hub.
function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  const t = useTranslations("Portal");
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("hub_back")}
      </button>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
    </div>
  );
}

// The documents progress card: a celebratory "all done" state, otherwise the
// ring + a remaining count. Approval-based (an upload alone does not fill it).
function ProgressCard({
  done,
  total,
  pct,
  remaining,
  brand,
  firmName,
}: {
  done: number;
  total: number;
  pct: number;
  remaining: number;
  brand: string;
  firmName: string;
}) {
  const t = useTranslations("Portal");
  const allDone = total > 0 && remaining === 0;
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      {allDone ? (
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">
              {t("all_done_title")}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("all_done_hint", { firm: firmName })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <ProgressRing pct={pct} brand={brand} />
          <div className="min-w-0">
            <div className="text-base font-semibold tracking-tight text-foreground">
              {t("progress", { done, total })}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {t("items_remaining", { count: remaining })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Circular progress ring with the percentage in the centre. The track uses a
// theme token (adapts light/dark); the filled arc is the firm's brand colour.
// The percentage uses the foreground token so it stays readable on any brand.
function ProgressRing({ pct, brand }: { pct: number; brand: string }) {
  const size = 64;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={brand}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums text-foreground">
        {pct}%
      </span>
    </div>
  );
}
