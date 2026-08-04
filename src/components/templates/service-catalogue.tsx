"use client";

// The firm's SERVICE CATALOGUE — what you sell, defined once.
//
// The founder's framing, which is also the test for whether this is worth
// having: "Monthly bookkeeping, $400/mo, creates these 6 tasks — defined once
// and dropped onto any client." Without it you retype every line on every
// engagement, and there is nothing for tasks to hang off.
//
// A service is a TEMPLATE for an engagement item. Using one COPIES its values
// onto the engagement, where they can be changed for that client without
// touching the catalogue — the founder's call: picking a service SUGGESTS the
// price, it does not lock it. That is also why editing a service here never
// rewrites a proposal a client has already agreed to.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  archiveFirmServiceAction,
  createFirmServiceAction,
  updateFirmServiceAction,
} from "@/app/actions/firm-services";
import {
  BILLING_FREQUENCIES,
  RATE_TYPES,
  type BillingFrequency,
  type RateType,
} from "@/lib/engagements/items";
import { formatCurrency, type AppLocale } from "@/lib/format";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  rateCents: number | null;
  rateType: RateType;
  billingFrequency: BillingFrequency;
  taxPct: number | null;
  archivedAt: string | null;
};

type Draft = Omit<ServiceRow, "id" | "archivedAt">;

const EMPTY: Draft = {
  name: "",
  description: null,
  rateCents: null,
  rateType: "item",
  billingFrequency: "once",
  taxPct: null,
};

type FreqKey =
  | "item_freq_once"
  | "item_freq_weekly"
  | "item_freq_monthly"
  | "item_freq_quarterly"
  | "item_freq_yearly";
type RateKey = "item_rate_item" | "item_rate_hour";

export function ServiceCatalogue({
  services,
  locale,
  canManage,
  /**
   * Open the "add service" dialog on first render.
   *
   * The + Create panel's "Service template" row means CREATE ONE, not "go and
   * look at the list" — the founder's correction: "the whole function is to
   * create one not just bring you to the page". So it arrives with ?new=service
   * and the form is already open.
   */
  openOnMount = false,
}: {
  services: ServiceRow[];
  locale: AppLocale;
  canManage: boolean;
  openOnMount?: boolean;
}) {
  const t = useTranslations("Engagements");
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  // Seeded, not forced: once you close it, it stays closed for this page view.
  const [draft, setDraft] = useState<Draft | null>(
    openOnMount && canManage ? { ...EMPTY } : null,
  );
  const [busy, setBusy] = useState(false);

  function open(service: ServiceRow | null) {
    setEditing(service);
    setDraft(
      service
        ? {
            name: service.name,
            description: service.description,
            rateCents: service.rateCents,
            rateType: service.rateType,
            billingFrequency: service.billingFrequency,
            taxPct: service.taxPct,
          }
        : { ...EMPTY },
    );
  }

  function report(res: { ok: boolean; needsMigration?: boolean }) {
    if (res.ok) return true;
    toast.error(
      res.needsMigration ? t("services_needs_migration") : t("services_failed"),
    );
    return false;
  }

  async function save() {
    if (!draft || busy || draft.name.trim() === "") return;
    setBusy(true);
    try {
      const payload = { ...draft, name: draft.name.trim() };
      const res = editing
        ? await updateFirmServiceAction(editing.id, payload)
        : await createFirmServiceAction(payload);
      if (report(res)) {
        setDraft(null);
        setEditing(null);
        startTransition(() => {
          // A server action revalidates /templates; this pulls the new list in.
          window.location.reload();
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(service: ServiceRow) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await archiveFirmServiceAction(
        service.id,
        service.archivedAt == null,
      );
      if (report(res)) window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  // Rate reads in dollars and stores in cents. Blank stays NULL — "priced per
  // engagement" is a real service, and $0.00 would offer the work for free.
  function setRate(raw: string) {
    if (!draft) return;
    const trimmed = raw.trim();
    if (trimmed === "") return setDraft({ ...draft, rateCents: null });
    const dollars = Number(trimmed.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars)) return;
    setDraft({ ...draft, rateCents: Math.round(dollars * 100) });
  }

  function priceLabel(s: ServiceRow): string {
    if (s.rateCents == null) return t("services_price_tbd");
    const money = formatCurrency(s.rateCents / 100, locale);
    const per = s.rateType === "hour" ? t("item_rate_hour").toLowerCase() : null;
    const freq =
      s.billingFrequency === "once"
        ? null
        : t(`item_freq_${s.billingFrequency}` as FreqKey).toLowerCase();
    return [money, per ? `/ ${per}` : null, freq].filter(Boolean).join(" ");
  }

  return (
    <div className="space-y-3">
      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("services_empty")}</p>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => open(null)}
            >
              <Plus className="size-4" aria-hidden />
              {t("services_add")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {services.map((s) => (
              <li
                key={s.id}
                className={
                  "group rounded-xl border border-border/60 bg-card p-4 transition-colors" +
                  (s.archivedAt ? " opacity-60" : "")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {priceLabel(s)}
                    </p>
                  </div>
                  {canManage && (
                    // Hover-revealed, like the other cards on this page: a row
                    // of controls parked on every card turns a list you read
                    // into a control panel.
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => open(s)}
                        aria-label={t("services_edit")}
                        title={t("services_edit")}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleArchive(s)}
                        aria-label={
                          s.archivedAt
                            ? t("services_restore")
                            : t("services_archive")
                        }
                        title={
                          s.archivedAt
                            ? t("services_restore")
                            : t("services_archive")
                        }
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {s.archivedAt ? (
                          <ArchiveRestore className="size-3.5" aria-hidden />
                        ) : (
                          <Archive className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </div>
                  )}
                </div>
                {s.description && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {s.description}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => open(null)}
            >
              <Plus className="size-4" aria-hidden />
              {t("services_add")}
            </Button>
          )}
        </>
      )}

      <Dialog
        open={draft != null}
        onOpenChange={(o) => {
          if (!o) {
            setDraft(null);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("services_edit") : t("services_add")}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="svc-name">{t("services_name")}</Label>
                <Input
                  id="svc-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={t("services_name_placeholder")}
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="svc-rate">{t("item_rate")}</Label>
                  <Input
                    id="svc-rate"
                    inputMode="decimal"
                    value={
                      draft.rateCents == null
                        ? ""
                        : (draft.rateCents / 100).toFixed(2)
                    }
                    onChange={(e) => setRate(e.target.value)}
                    placeholder={t("services_rate_placeholder")}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="svc-ratetype">{t("item_rate_type")}</Label>
                  <select
                    id="svc-ratetype"
                    value={draft.rateType}
                    onChange={(e) =>
                      setDraft({ ...draft, rateType: e.target.value as RateType })
                    }
                    className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {RATE_TYPES.map((r) => (
                      <option key={r} value={r}>
                        {t(`item_rate_${r}` as RateKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="svc-freq">{t("item_billing_frequency")}</Label>
                  <select
                    id="svc-freq"
                    value={draft.billingFrequency}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        billingFrequency: e.target.value as BillingFrequency,
                      })
                    }
                    className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {BILLING_FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {t(`item_freq_${f}` as FreqKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="svc-tax">{t("item_tax")}</Label>
                  <Input
                    id="svc-tax"
                    inputMode="decimal"
                    value={draft.taxPct == null ? "" : String(draft.taxPct)}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setDraft({
                        ...draft,
                        taxPct: v === "" ? null : Number(v) || 0,
                      });
                    }}
                    placeholder="—"
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="svc-desc">{t("item_description")}</Label>
                <Textarea
                  id="svc-desc"
                  value={draft.description ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value || null })
                  }
                  rows={3}
                  placeholder={t("services_description_placeholder")}
                  className="mt-1 text-sm"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {t("services_copy_note")}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(null);
                setEditing(null);
              }}
            >
              {t("services_cancel")}
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={busy || !draft || draft.name.trim() === ""}
            >
              {t("services_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
