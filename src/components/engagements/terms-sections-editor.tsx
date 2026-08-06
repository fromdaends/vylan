"use client";

// Terms, authored as labelled sections.
//
// The founder: "you can have multiple sections for the terms. Like you can
// create boxes and label them differently."
//
// ── ONE EDITOR, BOTH BUILDERS ──────────────────────────────────────────────
//
// Rendered by the engagement template builder's Terms tab AND the engagement
// builder's Proposal step. The founder has had to say "fix it in the template
// builder as well" three times in this project; a shared component is the only
// version of that instruction that holds by itself.
//
// ── NO RICH TEXT, DELIBERATELY ─────────────────────────────────────────────
//
// The founder corrected me on this directly: they did not want an editor, they
// wanted structure. Plain text stays plain text — nothing in this repo renders
// HTML from a database, and adding that would change what is stored on
// contracts clients have already signed.

import { useTranslations } from "next-intl";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyTermsSection,
  type TermsSection,
} from "@/lib/engagements/terms-sections";

export function TermsSectionsEditor({
  sections,
  onChange,
  /** Shown under the last section — "use my firm's standard terms" and so on.
   *  The two builders offer different actions, so they pass their own. */
  actions,
}: {
  sections: TermsSection[];
  onChange: (next: TermsSection[]) => void;
  actions?: React.ReactNode;
}) {
  const t = useTranslations("Templates");

  function patch(idx: number, next: Partial<TermsSection>) {
    onChange(sections.map((s, i) => (i === idx ? { ...s, ...next } : s)));
  }
  function move(idx: number, delta: number) {
    const to = idx + delta;
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
          {t("terms_empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {sections.map((section, idx) => (
            <li
              key={idx}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-2">
                {/* Order matters on a contract — "Fees" after "Scope" reads
                    differently from the other way round. */}
                <div className="flex shrink-0 flex-col text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={t("terms_move_up")}
                    className="leading-none transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === sections.length - 1}
                    aria-label={t("terms_move_down")}
                    className="leading-none transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
                <GripVertical
                  className="size-3.5 shrink-0 text-muted-foreground/50"
                  aria-hidden
                />
                <Input
                  value={section.heading}
                  onChange={(e) => patch(idx, { heading: e.target.value })}
                  placeholder={t("terms_heading_placeholder")}
                  aria-label={t("terms_heading_placeholder")}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => onChange(sections.filter((_, i) => i !== idx))}
                  aria-label={t("remove")}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Textarea
                value={section.body}
                onChange={(e) => patch(idx, { body: e.target.value })}
                placeholder={t("terms_body_placeholder")}
                aria-label={t("terms_body_placeholder")}
                rows={5}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...sections, emptyTermsSection()])}
        >
          <Plus className="size-3.5" />
          {t("terms_add_section")}
        </Button>
        {actions}
      </div>
    </div>
  );
}
