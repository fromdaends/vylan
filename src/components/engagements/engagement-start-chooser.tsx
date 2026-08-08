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
// IT IS THE WIZARD'S FIRST STEP, NOT A DOORWAY INTO IT. Founder: "have this
// tab and the other be the same thing instead of two separate steps, they
// transition into one another... so it doesn't look weird." It used to render
// in a bare dialog of its own, which then vanished and was replaced by the
// three-column builder — two different objects for one continuous act. Now it
// renders inside that same card, and only the middle of it changes.
//
// So it is CONTROLLED and buttonless: the builder holds the answer, and the
// shell's own Continue is what commits it. A Next button here would be a
// second one in the same card, six pixels from the real one.

import { useTranslations } from "next-intl";
import { Check, FilePlus2, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/cn";

export type StartTemplate = {
  id: string;
  name: string;
  /** Private ones are grouped separately, the way Canopy's dropdown does. */
  access: "team" | "private";
};

export function EngagementStartChooser({
  templates,
  mode,
  templateId,
  onModeChange,
  onTemplateChange,
}: {
  templates: StartTemplate[];
  /** NULL until they answer — neither card starts chosen. */
  mode: "template" | "scratch" | null;
  templateId: string;
  onModeChange: (mode: "template" | "scratch") => void;
  onTemplateChange: (id: string) => void;
}) {
  const t = useTranslations("Engagements");
  const picked = templateId;

  const team = templates.filter((x) => x.access === "team");
  const mine = templates.filter((x) => x.access === "private");

  return (
    // Top-aligned, like every other step. It used to centre itself because it
    // was alone in a tall empty dialog; inside the wizard it is one step among
    // six and starting where they start is what makes the transition read as a
    // change of content rather than a change of screen.
    <div className="flex max-w-xl flex-col gap-5">
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
          onSelect={() => onModeChange("template")}
        />
        <ModeCard
          active={mode === "scratch"}
          icon={FilePlus2}
          title={t("start_from_scratch")}
          hint={t("start_from_scratch_hint")}
          onSelect={() => onModeChange("scratch")}
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
            onChange={(e) => onTemplateChange(e.target.value)}
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
        disabled &&
          "cursor-not-allowed opacity-55 hover:border-border/60 hover:bg-transparent",
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
