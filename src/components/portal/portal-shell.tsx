"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
    (i) => i.status === "submitted" || i.status === "approved" || i.status === "na",
  ).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

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

  function handleItemUpdated(itemId: string, patch: Partial<typeof items[0]>) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    );
  }
  function handleUploaded(itemId: string) {
    setUploads((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
    handleItemUpdated(itemId, { status: "submitted" });
  }

  return (
    <div className="flex-1 flex flex-col">
      <header
        className="relative overflow-hidden"
        style={{ background: ctx.firm.brand_color, color: "#fafaf9" }}
      >
        {/* Subtle highlight overlay */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,.18),transparent_60%)]"
        />
        <div className="relative mx-auto max-w-2xl px-4 sm:px-6 py-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {firmLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firmLogoUrl}
                alt={ctx.firm.name}
                className="size-10 rounded-xl object-cover bg-white/10 shrink-0"
              />
            ) : (
              <div
                className="size-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center font-semibold text-sm shrink-0"
                aria-hidden
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold truncate text-base">
                {ctx.firm.name}
              </div>
              <div className="text-xs opacity-80 truncate">
                {ctx.engagement.title}
              </div>
            </div>
          </div>
          <a
            href={`?lang=${otherLocale}`}
            className="text-xs font-medium px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 transition-colors shrink-0"
          >
            {otherLocale.toUpperCase()}
          </a>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 sm:px-6 py-8 space-y-8 animate-in-up">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("greeting", { name: ctx.client.display_name })}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {t("subhead", { firm: ctx.firm.name })}
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between text-sm mb-3">
            <span className="font-medium">{t("progress", { done, total })}</span>
            <span className="text-muted-foreground font-mono tabular-nums">
              {pct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${pct}%`,
                background: ctx.firm.brand_color,
              }}
            />
          </div>
        </section>

        <section className="space-y-3 animate-in-stagger">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              token={ctx.engagement.magic_token ?? ""}
              item={item}
              locale={locale}
              uploadedCount={uploads[item.id] ?? 0}
              onUploaded={() => handleUploaded(item.id)}
              onStatusChange={(status) =>
                handleItemUpdated(item.id, { status })
              }
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
