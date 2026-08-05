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
import { Plus, Receipt } from "lucide-react";
import {
  TemplateRow,
  TemplateRowList,
} from "@/components/templates/template-row";
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
  /** The work this service implies (1620). Null = it carries none. */
  taskTemplateId: string | null;
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
  taskTemplateId: null,
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
  taskTemplates = [],
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
  /** The firm's task templates (1570), so a service can name the work it
   *  implies. Empty hides the picker entirely. */
  taskTemplates?: { id: string; name: string; steps: string[] }[];
  locale: AppLocale;
  canManage: boolean;
  openOnMount?: boolean;
}) {
  const t = useTranslations("Engagements");
  // A SECOND translator, for this file's own Templates-namespace copy. The
  // service form's field labels (item_rate, item_tax…) are shared with the
  // engagement items editor and live under Engagements; the work-link copy is
  // this screen's own and lives under Templates. Reading both from one
  // translator is what printed `Engagements.service_does_work` on screen.
  const tT = useTranslations("Templates");
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
            taskTemplateId: service.taskTemplateId,
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
          <TemplateRowList>
            {services.map((s) => (
              <TemplateRow
                key={s.id}
                icon={Receipt}
                name={s.name}
                // Price first, then the description — the price is what you
                // scan a service list for.
                // Price, then the work it implies, then the description. The
                // link has to read from BOTH ends: the catalogue says which
                // work a service brings, and the engagement says which service
                // brought each task.
                meta={[
                  priceLabel(s),
                  s.taskTemplateId
                    ? tT("service_does_work_meta", {
                        name:
                          taskTemplates.find((tt) => tt.id === s.taskTemplateId)
                            ?.name ?? "",
                      })
                    : "",
                  s.description ?? "",
                ]
                  .filter(Boolean)
                  .join(" \u2014 ")}
                dimmed={s.archivedAt != null}
                // Clicking IS editing, the same as every other template type.
                onSelect={canManage ? () => open(s) : undefined}
                badges={
                  s.archivedAt ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
                      {tT("services_archived_badge")}
                    </span>
                  ) : null
                }
                actions={
                  canManage
                    ? [
                        { label: t("services_edit"), onSelect: () => open(s) },
                        {
                          label: s.archivedAt
                            ? t("services_restore")
                            : t("services_archive"),
                          destructive: s.archivedAt == null,
                          onSelect: () => toggleArchive(s),
                        },
                      ]
                    : []
                }
              />
            ))}
          </TemplateRowList>
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
                {/* ── THE WORK THIS SERVICE IMPLIES (1620) ──────────────────
                    Canopy's Service Item carries "the tasks you'll perform".
                    Selling a service and then separately remembering to apply
                    the matching task template is the manual step this removes.

                    The picker is only drawn when the firm HAS task templates —
                    a dropdown whose only entry is "none" teaches nobody that
                    the feature exists, it just adds a control that does
                    nothing. */}
                {taskTemplates.length > 0 && (
                  <div className="sm:col-span-2">
                    <Label htmlFor="svc-tasks">{tT("service_does_work")}</Label>
                    <select
                      id="svc-tasks"
                      value={draft.taskTemplateId ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          taskTemplateId: e.target.value || null,
                        })
                      }
                      className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">{tT("service_does_work_none")}</option>
                      {taskTemplates.map((tt) => (
                        <option key={tt.id} value={tt.id}>
                          {tt.name}
                        </option>
                      ))}
                    </select>
                    {/* The STEPS, right there. A dropdown showing only a
                        template's name asks you to remember what is inside it;
                        the founder's whole point is that the service and its
                        work must not feel like separate things. */}
                    {(() => {
                      const picked = taskTemplates.find(
                        (tt) => tt.id === draft.taskTemplateId,
                      );
                      const steps = picked?.steps ?? [];
                      return steps.length > 0 ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          {steps.slice(0, 5).join(" \u00b7 ")}
                          {steps.length > 5 && ` +${steps.length - 5}`}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {tT("service_does_work_hint")}
                        </p>
                      );
                    })()}
                  </div>
                )}
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
