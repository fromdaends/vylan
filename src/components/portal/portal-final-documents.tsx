"use client";

import { useTranslations } from "next-intl";
import { FileText, Download, FileCheck2, Lock } from "lucide-react";

// The client-facing "Your completed documents" card: the finished work the
// accountant has returned. Each file downloads through the gated
// /api/portal/deliverables route (never an embedded signed URL), so the invoice
// lock gates it server-side. When `locked` is true the finished work exists but
// the invoice is unpaid, so the card shows a polite locked state (the "Pay now"
// card sits directly above) instead of the download links.
export function PortalFinalDocuments({
  docs,
  token,
  locked,
  justReturnedPaid,
}: {
  docs: {
    id: string;
    original_filename: string;
    display_name: string | null;
  }[];
  token: string;
  locked: boolean;
  // True right after returning from a successful Stripe checkout (?paid=1). The
  // page reconciles the invoice to paid on this same request, so optimistically
  // unlock the card (the gated download route will already allow the bytes).
  justReturnedPaid: boolean;
}) {
  const t = useTranslations("Portal");
  if (docs.length === 0) return null;
  const enc = encodeURIComponent(token);
  const effectiveLocked = locked && !justReturnedPaid;

  if (effectiveLocked) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {t("final_documents_title")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("final_locked_body")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <FileCheck2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">
            {t("final_documents_title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("final_documents_subtitle")}
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3.5 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <FileText
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate text-sm font-medium">
                {d.display_name || d.original_filename}
              </span>
            </div>
            <a
              href={`/api/portal/deliverables/${d.id}?token=${enc}&download=1`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Download className="size-3.5" aria-hidden />
              {t("final_download")}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
