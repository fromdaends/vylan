"use client";

// The question Canopy asks BEFORE the builder opens.
//
// Their flow starts with a small dialog — "Create with template" or "Create
// from scratch", plus a template dropdown — and only then opens the big
// modal. The founder's ask: "when you create an engagement, there should be a
// questionnaire that goes: start from scratch, or a template. And then there's
// a dropdown with all your existing templates, but they're not document
// collection templates, they're engagement templates."
//
// WHY IT IS WORTH A WHOLE SCREEN. The builder is five steps deep. Picking a
// template afterwards would have to overwrite work already typed, and asking
// "are you sure you want to replace this?" is a worse conversation than asking
// "which of these are you starting from?" before anything exists.
//
// It renders INSTEAD of the builder rather than over it, so there is nothing
// underneath to overwrite and no dismiss-by-accident.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FilePlus2, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type StartTemplate = {
  id: string;
  name: string;
  /** Private ones are grouped separately, the way Canopy's dropdown does. */
  access: "team" | "private";
};

export function EngagementStartChooser({
  templates,
  onStart,
}: {
  templates: StartTemplate[];
  /** null = from scratch. */
  onStart: (templateId: string | null) => void;
}) {
  const t = useTranslations("Engagements");
  const [mode, setMode] = useState<"template" | "scratch">(
    // Scratch when there is nothing to pick — offering "with template" first
    // on a firm with no templates leads with a dead end.
    templates.length > 0 ? "template" : "scratch",
  );
  const [picked, setPicked] = useState<string>(templates[0]?.id ?? "");

  const team = templates.filter((x) => x.access === "team");
  const mine = templates.filter((x) => x.access === "private");

  return (
    <div className="mx-auto max-w-xl space-y-5 py-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("start_title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("start_subtitle")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={mode === "template"}
          disabled={templates.length === 0}
          icon={LayoutTemplate}
          title={t("start_with_template")}
          hint={
            templates.length === 0
              ? t("start_no_templates")
              : t("start_with_template_hint")
          }
          onSelect={() => setMode("template")}
        />
        <ModeCard
          active={mode === "scratch"}
          icon={FilePlus2}
          title={t("start_from_scratch")}
          hint={t("start_from_scratch_hint")}
          onSelect={() => setMode("scratch")}
        />
      </div>

      {mode === "template" && templates.length > 0 && (
        <div>
          <label
            htmlFor="start-template"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("start_template_label")}
          </label>
          <select
            id="start-template"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Grouped exactly as the reference does — the firm's, then yours.
                Optgroups are only drawn when they have members, so a firm with
                no private templates never sees an empty heading. */}
            {team.length > 0 && (
              <optgroup label={t("start_group_team")}>
                {team.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
            {mine.length > 0 && (
              <optgroup label={t("start_group_private")}>
                {mine.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() =>
            onStart(mode === "template" && picked !== "" ? picked : null)
          }
        >
          {t("start_next")}
        </Button>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  disabled = false,
  icon: Icon,
  title,
  hint,
  onSelect,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof LayoutTemplate;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "relative rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-accent bg-accent/5"
          : "border-border/60 hover:border-border hover:bg-muted/40",
        disabled && "cursor-not-allowed opacity-55 hover:border-border/60 hover:bg-transparent",
      )}
    >
      {active && (
        <Check
          className="absolute right-3 top-3 size-4 text-accent"
          aria-hidden
        />
      )}
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </button>
  );
}
