"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  TemplateBuilderShell,
} from "@/components/templates/template-builder-shell";
import { cn } from "@/lib/cn";
import type { InvoiceableEngagement } from "./new-invoice-button";

// Pick an engagement, land on it with the invoice dialog open.
//
// ── WHY IT ASKS FOR AN ENGAGEMENT AND NOT A CLIENT AND AN AMOUNT ───────────
//
// The design handoff's single-card invoice asks for a client, an optional
// engagement ("None — a one-off invoice") and an amount. Vylan cannot answer
// that form: an invoice here IS an engagement's invoice —
// `createInvoiceForEngagement` takes an engagement id, derives the client from
// it, and a database unique index caps it at one live invoice per engagement.
// A one-off client invoice is not a shape this data model has, and inventing
// one in the UI would be a form that fails on submit.
//
// So this is the handoff's card, asking the question the product can actually
// answer. The amount and the due date are asked for on the engagement, by the
// one invoice dialog that has always drafted them — this walks you there rather
// than reimplementing it, which is the decision the dialog version made too.
//
// Copy is passed in from the server component rather than read here, so this
// stays a dumb list — the only logic is the filter.
export function NewInvoicePicker({
  engagements,
  labels,
}: {
  engagements: InvoiceableEngagement[];
  labels: {
    button: string;
    title: string;
    hint: string;
    empty: string;
    search: string;
    cancel: string;
    pick: string;
    footnote: string;
    draft: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return engagements;
    return engagements.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        (e.clientName ?? "").toLowerCase().includes(needle),
    );
  }, [engagements, q]);

  function draft() {
    if (!picked) return;
    setOpen(false);
    // ?panel=invoice opens the one invoice dialog there.
    router.push(`/engagements/${picked}?panel=invoice`);
  }

  return (
    <>
      {/* The one coloured button on this screen (UI kit rule 1), sized to
          match the header search it sits beside. */}
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="h-[42px] gap-2 rounded-[11px] px-5 text-[14.5px] font-semibold shadow-[0_4px_14px_oklch(0.55_0.18_258_/_0.28)]"
      >
        <Plus className="size-[18px]" />
        {labels.button}
      </Button>

      {open && (
        <TemplateBuilderShell
          title={labels.title}
          explainer={labels.hint}
          // ONE step, so the shell drops the steps box and shrinks to 560px.
          tabs={[{ key: "only", label: labels.title }]}
          activeTab="only"
          onTabChange={() => {}}
          // No engagements left to invoice means no Draft button at all — the
          // card is an explanation, not a form, and a permanently-greyed
          // primary under it is a promise it cannot keep.
          finalAction={
            engagements.length === 0
              ? undefined
              : { label: labels.draft, disabled: !picked, onClick: draft }
          }
          onClose={() => setOpen(false)}
        >
          {engagements.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {labels.empty}
            </p>
          ) : (
            <div className="space-y-3.5">
              <Field label={labels.pick} required>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={labels.search}
                    aria-label={labels.search}
                    className="pl-8"
                    autoFocus
                  />
                </div>
              </Field>

              <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
                {filtered.map((e) => {
                  const on = picked === e.id;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        // SELECTS rather than navigates. The dialog version
                        // jumped on click, which would leave the card's footer
                        // button with nothing left to do.
                        onClick={() => setPicked(e.id)}
                        className={cn(
                          "w-full px-3 py-2.5 text-left transition-colors focus-visible:outline-none",
                          on
                            ? "bg-accent-subtle"
                            : "hover:bg-muted focus-visible:bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "block truncate text-sm",
                            on
                              ? "font-[550] text-accent"
                              : "font-medium text-foreground",
                          )}
                        >
                          {e.title}
                        </span>
                        {e.clientName && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {e.clientName}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Says what the button will and will NOT do. "Draft invoice"
                  beside a client's name reads like something being sent. */}
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {labels.footnote}
              </p>
            </div>
          )}
        </TemplateBuilderShell>
      )}
    </>
  );
}
