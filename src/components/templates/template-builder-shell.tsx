"use client";

// ONE chrome for every builder in this product.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// The founder: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES SHOULD ALL BE
// THE SAME. STOP BUILDING INCONSISTENT THINGS."
//
// They were looking at three builders that had nothing in common but their
// purpose. An engagement template was a full-screen thing with tabs and a live
// preview. A task template was a small card that unfolded under the list. A
// service was a modal dialog. Same act — describe a reusable shape — and three
// different rooms to do it in, because each was written on its own day.
//
// So the chrome is a component, not a pattern to be re-typed. A builder
// supplies its steps and its fields; it does not get an opinion about the
// furniture.
//
// This is CLAUDE.md's cohesion rule applied to layout rather than to data: the
// reason "change how builders look" must be one edit, not eight.
//
// ── WHAT THE CHROME IS NOW ─────────────────────────────────────────────────
//
// A GUIDED WIZARD: two floating cards over the dimmed app, per the
// `design_handoff_template_creation_flow` handoff. The setup card carries a
// steps box on the left — numbered circles that turn into green checkmarks as
// you leave them, with a progress bar pinned to the bottom — and the current
// step's fields on the right. A second card beside it shows, live, the thing
// you are describing.
//
// It replaces a full-screen tabbed panel. A tab rail says "here are eight
// places you may go"; a steps box says "here is where you are, here is what is
// behind you, here is what is left" — which is the honest shape of every one
// of these flows, because they all end in a single act.
//
// ── WHAT A BUILDER STILL OWNS ──────────────────────────────────────────────
//
// Its steps, its fields, its validation, its save. The shell knows nothing
// about what is being built — it takes rendered nodes. That keeps a service
// builder from having to pretend it is an engagement template to get the same
// frame.
//
// ── WHERE THE PIXELS LIVE ──────────────────────────────────────────────────
//
// Sizes and motion are in `globals.css` under "THE GUIDED WIZARD" (.wizard-*).
// Colour is NEVER a literal here: the handoff's palette was extracted from the
// light theme, and writing those values back in would give us a wizard that is
// white-on-white in dark mode. Every surface below reaches for a token.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type BuilderTab = {
  key: string;
  label: string;
  /** The one line under the step's name in the steps box. Optional, because a
   *  step called "Pricing" does not need to be told it is about pricing. */
  description?: string;
  /** Canopy's red mark on a step whose required fields are empty. */
  incomplete?: boolean;
};

export type BuilderAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
};

/**
 * What the last step's Continue BECOMES.
 *
 * The founder: "the next button at the end of the engagement creation should
 * flip into a send button." A disabled Next on the final step is a dead control
 * at the exact moment there is one obvious thing left to do — so the last Next
 * is the thing you came here to do, with a check instead of an arrow.
 */
export type BuilderFinalAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

// ───────────────────────────────────────────────────────────────────────────
// THE FULL WIZARD — overlay, setup card, preview card.
// ───────────────────────────────────────────────────────────────────────────

export function TemplateBuilderShell({
  kicker,
  title,
  explainer,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  finalAction,
  onClose,
  preview,
  previewLabel,
  previewOpen,
  error,
  children,
}: {
  /** The uppercase line above the wizard's title — what KIND of thing this is
   *  ("ENGAGEMENT TEMPLATE"). The title alone reads the same on four screens. */
  kicker?: string;
  title: string;
  /** One line saying what this screen makes, in the steps box under the title. */
  explainer?: string;
  tabs: BuilderTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Extra buttons in the step header — "Save draft" and nothing else so far.
   *  The primary save is `finalAction`, in the footer where the flow ends. */
  headerActions?: BuilderAction[];
  finalAction: BuilderFinalAction;
  onClose: () => void;
  /** The live preview card. Omit it and the wizard is one card — a builder with
   *  nothing to show must not open an empty panel next to itself. */
  preview?: React.ReactNode;
  /** What the preview card is OF. An unlabelled preview showing a client name
   *  reads as a real engagement rather than a sample. */
  previewLabel?: string;
  previewOpen?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  const showPreview = preview != null && previewOpen !== false;
  const single = tabs.length <= 1;

  // Esc closes. Not a nicety — the wizard covers the whole app, and the only
  // other way out is a 30px button in a corner.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wizard-overlay fixed inset-0 z-50 flex items-center justify-center gap-5 p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "wizard-card flex overflow-hidden rounded-2xl bg-card",
          single ? "wizard-card-single" : "wizard-card-setup",
        )}
      >
        <BuilderChrome
          kicker={kicker}
          title={title}
          explainer={explainer}
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
          headerActions={headerActions}
          finalAction={finalAction}
          onClose={onClose}
          error={error}
        >
          {children}
        </BuilderChrome>
      </div>

      {showPreview && (
        <WizardPreviewCard label={previewLabel}>{preview}</WizardPreviewCard>
      )}
    </div>
  );
}

/**
 * The second card: what you are describing, as it will actually look.
 *
 * Its own export because engagement creation builds a preview with an extra
 * card stacked under the proposal, and a preview panel that can only be
 * produced by the component that owns the form is a preview panel nobody else
 * can have.
 */
export function WizardPreviewCard({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="wizard-card wizard-card-preview wizard-preview shrink-0 flex-col overflow-hidden rounded-2xl bg-card">
      {label && (
        <div className="shrink-0 border-b border-border px-5 py-3.5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </p>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 p-5">
        {children}
      </div>
    </aside>
  );
}

/**
 * Everything INSIDE the setup card: the steps box, the step header, the
 * scrolling form, and the Back / Continue footer.
 *
 * Its own component because engagement creation needs exactly this and nothing
 * else — it already draws its own outer box. Sharing the chrome rather than
 * copying it is the whole point: a change to how steps or Back/Continue look
 * now reaches every flow at once.
 */
export function BuilderChrome({
  kicker,
  title,
  explainer,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  finalAction,
  onClose,
  error,
  children,
}: {
  kicker?: string;
  title: string;
  explainer?: string;
  tabs: BuilderTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  headerActions?: BuilderAction[];
  finalAction: BuilderFinalAction;
  /** Omitted when the container already draws a close control. */
  onClose?: () => void;
  error?: string | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("Templates");
  const index = Math.max(
    0,
    tabs.findIndex((x) => x.key === activeTab),
  );
  const progress = useStepProgress(index);
  const current = tabs[index];
  const last = index === tabs.length - 1;
  const showSteps = tabs.length > 1;

  return (
    <>
      {showSteps && (
        <StepsBox
          kicker={kicker}
          title={title}
          explainer={explainer}
          tabs={tabs}
          index={index}
          done={progress.done}
          maxVisited={progress.maxVisited}
          onJump={onTabChange}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── STEP HEADER ────────────────────────────────────────────────
            The step you are on, not the thing you are building. The steps box
            already says what you are building, and repeating it here cost the
            one line that could tell you what this screen wants. On a
            single-step flow there is no steps box, so it says the title. */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-[22px] py-[15px]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15.5px] font-[620] tracking-[-0.01em]">
              {showSteps ? current?.label : title}
            </p>
            {(showSteps ? current?.description : explainer) && (
              <p className="mt-px truncate text-xs text-muted-foreground">
                {showSteps ? current?.description : explainer}
              </p>
            )}
          </div>
          {headerActions?.map((a) => (
            <Button
              key={a.label}
              type="button"
              size="sm"
              variant={a.variant ?? "outline"}
              disabled={a.disabled}
              onClick={a.onClick}
              className="h-[30px] shrink-0 px-3 text-[12.5px]"
            >
              {a.label}
            </Button>
          ))}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("cancel")}
              className="grid size-[30px] shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        {/* ── THE STEP ───────────────────────────────────────────────────
            Keyed on the step so React remounts it and the entrance animation
            re-runs. Forward and backward slide from opposite sides — the
            direction is the only thing that makes Back feel like Back. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            key={activeTab}
            className={cn(
              "px-[22px] pb-[26px] pt-5",
              progress.direction >= 0
                ? "wizard-step-forward"
                : "wizard-step-back",
            )}
          >
            {children}
            {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
          </div>
        </div>

        {/* ── BACK / CONTINUE ────────────────────────────────────────────
            On the last step Continue turns into the thing you came here to do.
            Not "Next, then find the save button" — the founder's rule. */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-[22px] py-[13px]">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={index === 0}
            onClick={() => onTabChange(tabs[index - 1].key)}
            className="disabled:opacity-35"
          >
            <ArrowLeft className="size-3.5" />
            {t("back")}
          </Button>
          {last ? (
            <Button
              type="button"
              size="sm"
              disabled={finalAction.disabled}
              onClick={finalAction.onClick}
              className="h-[34px]"
            >
              <Check className="size-3.5" />
              {finalAction.label}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => onTabChange(tabs[index + 1].key)}
              className="h-[34px]"
            >
              {t("continue_step")}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Where you are, what is behind you, what is left.
 *
 * ── THE CHECKMARK RULE, WHICH IS NOT THE OBVIOUS ONE ───────────────────────
 *
 * A check renders on a step only when it is BEHIND the one you are on. Going
 * Back visually clears the checks ahead of you and they re-check as you pass
 * them again. The naive version — "done once, ticked forever" — draws a column
 * of ticks with your position buried in the middle of it, which is exactly the
 * question the box exists to answer.
 *
 * `done` is still remembered while you are back there, because it is what makes
 * the steps ahead of you clickable. Progress is not forgotten; it is just not
 * DRAWN in front of where you are standing.
 */
function StepsBox({
  kicker,
  title,
  explainer,
  tabs,
  index,
  done,
  maxVisited,
  onJump,
}: {
  kicker?: string;
  title: string;
  explainer?: string;
  tabs: BuilderTab[];
  index: number;
  done: number[];
  maxVisited: number;
  onJump: (key: string) => void;
}) {
  const t = useTranslations("Templates");
  return (
    <div className="flex w-[234px] shrink-0 flex-col border-r border-border bg-muted px-[18px] pb-[18px] pt-[22px]">
      {kicker && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {kicker}
        </p>
      )}
      <p className="mt-1.5 text-[16.5px] font-[620] leading-tight tracking-[-0.015em]">
        {title}
      </p>
      {explainer && (
        <p className="mt-[7px] text-xs leading-relaxed text-muted-foreground">
          {explainer}
        </p>
      )}

      <ol className="mt-[22px] flex flex-col">
        {tabs.map((tab, i) => {
          // A check only ahead-of-nothing: behind the cursor AND actually left.
          const isDone = i < index && done.includes(i);
          const active = i === index;
          const reachable = i <= maxVisited;
          const connectorDone = isDone;
          return (
            <li key={tab.key}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onJump(tab.key)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex w-full items-start gap-3 text-left",
                  reachable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span className="flex shrink-0 flex-col items-center">
                  <span
                    className={cn(
                      "grid size-[26px] place-items-center rounded-full border-2 text-xs font-semibold transition-colors duration-[250ms]",
                      isDone
                        ? "border-success bg-success text-success-foreground"
                        : active
                          ? "border-accent bg-card text-accent"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {isDone ? (
                      <Check className="wizard-check size-[13px] stroke-[3]" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {i < tabs.length - 1 && (
                    <span
                      className={cn(
                        "h-5 w-0.5 rounded-full transition-colors duration-300",
                        connectorDone ? "bg-success" : "bg-border",
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0 pb-2 pt-1">
                  <span
                    className={cn(
                      "block text-[13px] font-[560] leading-snug transition-colors",
                      active || isDone
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {tab.label}
                    {/* Said in TEXT too, not colour alone — a red dot is
                        invisible to anyone who cannot see red. */}
                    {tab.incomplete && (
                      <span
                        className="ml-1.5 inline-block size-1.5 rounded-full bg-destructive align-middle"
                        aria-label={t("tab_incomplete")}
                      />
                    )}
                  </span>
                  {tab.description && (
                    <span className="mt-px block text-[11px] leading-snug text-muted-foreground">
                      {tab.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex-1" />
      <p className="mb-1.5 text-[11.5px] text-muted-foreground">
        {t("step_of", { n: index + 1, total: tabs.length })}
      </p>
      <div className="h-1 overflow-hidden rounded-sm bg-border">
        <div
          className="h-full rounded-sm bg-accent transition-[width] duration-[350ms] ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ width: `${((index + 1) / tabs.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Watches the step index the builder owns and derives the three things the
 * steps box needs that a builder should never have to hold: which steps are
 * done, how far you have ever got, and which way you just moved.
 *
 * Derived rather than lifted deliberately — a builder that had to maintain
 * `done[]` would be a builder with an opinion about the furniture, and four of
 * them would maintain it four slightly different ways.
 */
function useStepProgress(index: number) {
  const [state, setState] = useState({
    done: [] as number[],
    maxVisited: index,
    direction: 1,
  });
  const prev = useRef(index);

  useEffect(() => {
    const from = prev.current;
    if (from === index) return;
    prev.current = index;
    setState((s) => ({
      // Moving FORWARD marks the step you left as done — including a jump,
      // because passing a step is passing a step however you did it.
      done:
        index > from && !s.done.includes(from) ? [...s.done, from] : s.done,
      maxVisited: Math.max(s.maxVisited, index),
      direction: index > from ? 1 : -1,
    }));
  }, [index]);

  return state;
}

// ── THE FIELD PRIMITIVES ───────────────────────────────────────────────────
//
// Lifted out of the engagement template builder. They were private to it, which
// is exactly why the other builders used raw inputs and ended up looking like
// different products.

/** A kicker-headed group inside a step. */
export function Fieldset({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3.5 pb-6 last:pb-0">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-[520] text-foreground"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The muted line under a step's heading that says what the step is for. */
export function WizardHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Two or three mutually exclusive answers, side by side.
 *
 * Replaces the full-width radio cards. A radio card is right when the options
 * need explaining; Team / Private and Once / Monthly do not, and at card size
 * they ate a third of a step to say two words.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label?: string;
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 flex-1 rounded-lg border text-[12.5px] font-[520] transition-colors",
              on
                ? "border-accent bg-accent-subtle text-accent"
                : "border-border bg-card text-foreground hover:border-border/70 hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function RadioCard({
  name,
  checked,
  onSelect,
  caption,
  label,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  caption: string;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors",
        checked
          ? "border-accent bg-accent-subtle"
          : "border-border hover:border-border/80",
      )}
    >
      <input
        type="radio"
        name={name}
        className="mt-0.5"
        checked={checked}
        onChange={onSelect}
      />
      <span>
        <span className="block text-xs text-muted-foreground">{caption}</span>
        <span className="block text-sm font-medium">{label}</span>
      </span>
    </label>
  );
}

/**
 * Canopy's Introduction rows: a label, a one-line hint, a switch — and the
 * field itself only once the switch is on.
 *
 * The content is HIDDEN when the switch goes off, not unmounted. Turning Video
 * off and back on must not lose the link you already pasted, which is the
 * difference between a toggle and a delete.
 */
export function ToggleRow({
  label,
  hint,
  on,
  onToggle,
  children,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-[550]">{label}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          onClick={onToggle}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            on ? "bg-accent" : "bg-border",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-card shadow-sm transition-[left]",
              on ? "left-[1.125rem]" : "left-0.5",
            )}
          />
        </button>
      </div>
      <div className={cn("pt-3", !on && "hidden")}>{children}</div>
    </div>
  );
}
