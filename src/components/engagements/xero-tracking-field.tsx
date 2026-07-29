"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

export type TrackingCategory = {
  categoryId: string;
  categoryName: string;
  options: Array<{ id: string; name: string }>;
};

// XERO tracking — a SECOND label on the transaction, alongside the account.
// The account says what KIND of spend it was; this says which PART of the
// business it was for ("Winnipeg store", "Marketing"). A client with two sites
// keeps one "Food Costs" account and tags each transaction with a location,
// instead of duplicating every account per site.
//
// Rendered only when the client's Xero organisation actually HAS categories —
// most do not, and an empty picker on every draft would be pure noise. Xero
// allows at most two, which is what keeps this a couple of small selects rather
// than a dialog.
//
// Optional by design: nothing here blocks approving or posting. A transaction
// with no tracking is perfectly valid, so this never appears in the amber
// "needs input" set.
export function XeroTrackingField({
  fileId,
  categories,
  value,
  disabled = false,
}: {
  fileId: string;
  categories: TrackingCategory[];
  // category id -> chosen option id
  value: Record<string, string | null>;
  disabled?: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, string | null>>(value);
  const [pending, setPending] = useState(false);

  if (categories.length === 0) return null;

  async function save(categoryId: string, optionId: string | null) {
    if (pending) return;
    const prev = picks;
    const next = { ...picks, [categoryId]: optionId };
    setPicks(next); // optimistic
    setPending(true);
    try {
      // The FULL map every time — the server shallow-replaces this key, so
      // sending only the edited category would drop the other one.
      const body: Record<string, { id: string; name: string } | null> = {};
      for (const c of categories) {
        const chosen = next[c.categoryId] ?? null;
        const opt = c.options.find((o) => o.id === chosen);
        body[c.categoryId] = opt ? { id: opt.id, name: opt.name } : null;
      }
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tracking: body }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
      else setPicks(prev); // revert
    } catch {
      setPicks(prev);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("xero_tracking_label")}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {categories.map((c) => (
          <label key={c.categoryId} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">
              {c.categoryName}
            </span>
            <select
              disabled={disabled || pending}
              value={picks[c.categoryId] ?? ""}
              onChange={(e) => save(c.categoryId, e.target.value || null)}
              aria-label={c.categoryName}
              className={cn(
                "rounded-md border border-border/60 bg-background px-2 py-1 text-xs",
                "disabled:opacity-60",
              )}
            >
              {/* Explicitly choosing "none" is a real answer, not a missing one. */}
              <option value="">{t("xero_tracking_none")}</option>
              {c.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
