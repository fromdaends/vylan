"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import type { PortalContext } from "@/lib/db/portal";
import { ItemCard } from "./item-card";
import { PortalFooter } from "./portal-footer";

export function PortalShell({
  ctx,
  locale,
  firmLogoUrl,
}: {
  ctx: PortalContext;
  locale: "fr" | "en";
  firmLogoUrl: string | null;
}) {
  const t = useTranslations("Portal");
  const [items, setItems] = useState(ctx.items);
  const [uploads, setUploads] = useState(ctx.uploaded_count_by_item);

  const total = items.length;
  const done = items.filter(
    (i) =>
      i.status === "submitted" || i.status === "approved" || i.status === "na",
  ).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const remaining = total - done;
  const allDone = total > 0 && remaining === 0;

  const brand = ctx.firm.brand_color;

  const initials = ctx.firm.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const otherLocale = locale === "fr" ? "en" : "fr";
  const helpSubject = `${ctx.firm.name} — ${ctx.engagement.title}`;
  const helpBody =
    locale === "fr"
      ? `Bonjour,\n\nJ'ai une question concernant les documents demandés pour « ${ctx.engagement.title} ».\n\nMerci.`
      : `Hi,\n\nI have a question about the documents requested for "${ctx.engagement.title}".\n\nThanks.`;

  function handleItemUpdated(itemId: string, patch: Partial<(typeof items)[0]>) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    );
  }
  function handleUploaded(itemId: string) {
    setUploads((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
    handleItemUpdated(itemId, { status: "submitted" });
  }

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Soft, firm-coloured glow behind the top of the page — gives the clean
          surface depth without a heavy colour band. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72"
        style={{
          background: `radial-gradient(72% 100% at 50% 0%, ${brand}1f, transparent 72%)`,
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
                className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-black/5"
              />
            ) : (
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white ring-1 ring-black/5"
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
          <a
            href={`?lang=${otherLocale}`}
            className="shrink-0 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {otherLocale.toUpperCase()}
          </a>
        </div>
      </header>

      <main className="animate-in-up mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("greeting", { name: ctx.client.display_name })}
          </h1>
          <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            {t("subhead", { firm: ctx.firm.name })}
          </p>
        </section>

        {total > 0 && (
          <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            {allDone ? (
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/12 text-success">
                  <CheckCircle2 className="size-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold tracking-tight">
                    {t("all_done_title")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("all_done_hint", { firm: ctx.firm.name })}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {t("progress", { done, total })}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("items_remaining", { count: remaining })}
                    </div>
                  </div>
                  <div
                    className="font-mono text-2xl font-semibold leading-none tabular-nums"
                    style={{ color: brand }}
                  >
                    {pct}%
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out motion-reduce:transition-none"
                    style={{ width: `${pct}%`, background: brand }}
                  />
                </div>
              </>
            )}
          </section>
        )}

        <section className="animate-in-stagger space-y-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              token={ctx.engagement.magic_token ?? ""}
              item={item}
              locale={locale}
              uploadedCount={uploads[item.id] ?? 0}
              rejection={ctx.rejection_summary_by_item[item.id] ?? null}
              onUploaded={() => handleUploaded(item.id)}
              onStatusChange={(status) => handleItemUpdated(item.id, { status })}
            />
          ))}
        </section>

        <PortalFooter
          email={ctx.accountant_email}
          subject={helpSubject}
          body={helpBody}
        />
      </main>
    </div>
  );
}
