"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PortalContext } from "@/lib/db/portal";
import { ItemCard } from "./item-card";

export function PortalShell({
  ctx,
  locale,
}: {
  ctx: PortalContext;
  locale: "fr" | "en";
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
  const helpMailto = `mailto:?subject=${encodeURIComponent(
    `${ctx.firm.name} — ${ctx.engagement.title}`,
  )}&body=${encodeURIComponent(
    locale === "fr"
      ? `Bonjour,\n\nJ'ai une question concernant les documents demandés pour « ${ctx.engagement.title} ».\n\nMerci.`
      : `Hi,\n\nI have a question about the documents requested for "${ctx.engagement.title}".\n\nThanks.`,
  )}`;

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
        className="border-b border-border"
        style={{ background: ctx.firm.brand_color, color: "#fafaf9" }}
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="size-9 rounded-full bg-white/15 flex items-center justify-center font-semibold text-sm"
              aria-hidden
            >
              {initials}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{ctx.firm.name}</div>
              <div className="text-xs opacity-80 truncate">
                {ctx.engagement.title}
              </div>
            </div>
          </div>
          <a
            href={`?lang=${otherLocale}`}
            className="text-xs underline opacity-90 hover:opacity-100 shrink-0"
          >
            {otherLocale.toUpperCase()}
          </a>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 sm:px-6 py-6 space-y-6">
        <section>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("greeting", { name: ctx.client.display_name })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subhead", { firm: ctx.firm.name })}
          </p>
        </section>

        <section>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">
              {t("progress", { done, total })}
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-success transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </section>

        <section className="space-y-3">
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

        <footer className="text-center text-sm text-muted-foreground pt-4 border-t border-border">
          <p>
            {t("help_intro")}{" "}
            <a
              href={helpMailto}
              className="text-foreground underline"
            >
              {t("help_link")}
            </a>
          </p>
          <p className="mt-4 text-xs text-muted-foreground/70">
            {t("powered_by")} <span className="font-medium">Relai</span>
          </p>
        </footer>
      </main>
    </div>
  );
}
