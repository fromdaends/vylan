"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

export type XeroPublishStatus = "DRAFT" | "SUBMITTED" | "AUTHORISED";

// XERO ONLY — "Publish as": how this bill should land in the client's books.
//   DRAFT      -> Xero "Draft"            (edit it there before it counts)
//   SUBMITTED  -> Xero "Awaiting approval" (an approval workflow picks it up)
//   AUTHORISED -> Xero "Awaiting payment"  (live and payable — the default)
//
// The caller renders this only for an UNPAID expense on a Xero draft. A paid
// expense posts as a bank transaction, and Xero has no draft or approval state
// for a cash movement — rather than silently swallow the choice there, the card
// shows a one-line explanation instead of this control.
//
// Saves through the same stable resolve endpoint as every other field
// (deploy-skew-proof, optimistic with revert), and the server also remembers it
// as this client's default for the next bill.
export function XeroPublishStatusField({
  fileId,
  value,
  disabled = false,
}: {
  fileId: string;
  value: XeroPublishStatus;
  disabled?: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [status, setStatus] = useState<XeroPublishStatus>(value);
  const [pending, setPending] = useState(false);

  const options: { value: XeroPublishStatus; label: string }[] = [
    { value: "DRAFT", label: t("xero_status_draft") },
    { value: "SUBMITTED", label: t("xero_status_submitted") },
    { value: "AUTHORISED", label: t("xero_status_authorised") },
  ];
  const labelFor = (v: XeroPublishStatus) =>
    options.find((o) => o.value === v)?.label ?? v;

  async function save(next: XeroPublishStatus) {
    if (next === status || pending) return;
    const prev = status;
    setStatus(next); // optimistic
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publishStatus: next }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
      else setStatus(prev); // revert
    } catch {
      setStatus(prev);
    } finally {
      setPending(false);
    }
  }

  // Once the draft is decided (approved / posted) the choice is locked, but it
  // still has to be READABLE — it says how the bill reached Xero.
  if (disabled) {
    return (
      <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 opacity-80">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("xero_status_label")}
        </div>
        <div className="mt-0.5 text-sm font-medium text-foreground">
          {labelFor(status)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("xero_status_label")}
      </div>
      <div
        role="group"
        aria-label={t("xero_status_label")}
        className="mt-1 inline-flex flex-wrap rounded-md border border-border/60 p-0.5"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={pending}
            aria-pressed={status === o.value}
            onClick={() => save(o.value)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
              status === o.value
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1 max-w-xs text-[10px] leading-snug text-muted-foreground">
        {t("xero_status_hint")}
      </p>
    </div>
  );
}
