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
// So the chrome is a component now, not a pattern to be re-typed: title bar,
// explainer strip, tab rail, preview toggle, form-left / preview-right, and a
// Back/Next footer that walks the tabs. A builder supplies its tabs and its
// fields; it does not get an opinion about the furniture.
//
// This is CLAUDE.md's cohesion rule applied to layout rather than to data: the
// reason "change how builders look" must be one edit, not four.
//
// ── WHAT A BUILDER STILL OWNS ──────────────────────────────────────────────
//
// Its tabs, its fields, its validation, its save. The shell knows nothing about
// what is being built — it takes rendered nodes. That keeps a service builder
// from having to pretend it is an engagement template to get the same frame.

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Eye, EyeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type BuilderTab = {
  key: string;
  label: string;
  /** Canopy's red mark on a tab whose required fields are empty. */
  incomplete?: boolean;
};

export type BuilderAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
};

export function TemplateBuilderShell({
  title,
  explainer,
  tabs,
  activeTab,
  onTabChange,
  actions,
  onClose,
  preview,
  previewOpen,
  onPreviewToggle,
  error,
  children,
}: {
  title: string;
  /** One line saying what this screen makes. Optional — a builder whose object
   *  is obvious from its title does not need to explain itself. */
  explainer?: string;
  tabs: BuilderTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Save / Save draft, in the title bar where they stay reachable on a long
   *  tab instead of hiding under the form. */
  actions: BuilderAction[];
  onClose: () => void;
  /** The live preview panel. Omit it and the form takes the full width and the
   *  eye toggle disappears — a builder with nothing to show must not offer a
   *  button that shows nothing. */
  preview?: React.ReactNode;
  previewOpen?: boolean;
  onPreviewToggle?: () => void;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* ── TITLE BAR ──────────────────────────────────────────────────── */}
      <BuilderTitleBar title={title} actions={actions} onClose={onClose} />

      {explainer && (
        <p className="border-b border-border bg-accent-subtle/40 px-5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {explainer}
        </p>
      )}

      <BuilderChrome
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        preview={preview}
        previewOpen={previewOpen}
        onPreviewToggle={onPreviewToggle}
        error={error}
      >
        {children}
      </BuilderChrome>
    </div>
  );
}

function BuilderTitleBar({
  title,
  actions,
  onClose,
}: {
  title: string;
  actions: BuilderAction[];
  onClose: () => void;
}) {
  const t = useTranslations("Templates");
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        {actions.map((a) => (
          <Button
            key={a.label}
            type="button"
            size="sm"
            variant={a.variant ?? "default"}
            disabled={a.disabled}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("cancel")}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Everything BELOW a builder's title bar: the tab rail, the preview toggle, the
 * form-left / preview-right split, and the Back/Next footer.
 *
 * Its own component because engagement creation needs exactly this INSIDE its
 * modal, where the modal already draws the outer box and the title bar. The
 * founder: "the engagement creation ui is still lacking. IT still has that
 * Vylan UI look not the canopy Ui look that you can see on the template
 * builders. I want the same feel on engagement creation."
 *
 * Sharing the chrome rather than copying it is the whole point — a change to
 * how tabs or Back/Next look now reaches all four builders at once.
 */
export function BuilderChrome({
  tabs,
  activeTab,
  onTabChange,
  preview,
  previewOpen,
  onPreviewToggle,
  error,
  finalAction,
  children,
}: {
  tabs: BuilderTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  preview?: React.ReactNode;
  previewOpen?: boolean;
  onPreviewToggle?: () => void;
  error?: string | null;
  /**
   * What Next BECOMES on the last tab.
   *
   * The founder: "the next button at the end of the engagement creation should
   * flip into a send button." A disabled Next on the final step is a dead
   * control at the exact moment there is one obvious thing left to do.
   *
   * Optional: a template builder has no send, so its Next simply disables as
   * before.
   */
  finalAction?: { label: string; onClick: () => void; disabled?: boolean };
  children: React.ReactNode;
}) {
  const t = useTranslations("Templates");
  const tabIndex = useMemo(
    () => Math.max(0, tabs.findIndex((x) => x.key === activeTab)),
    [tabs, activeTab],
  );
  const showPreview = preview != null && previewOpen !== false;

  return (
    <>
      {/* ── TABS + PREVIEW TOGGLE ──────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div
          role="tablist"
          aria-label={t("tab_nav_label")}
          className="flex items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => onTabChange(tab.key)}
                className={cn(
                  "relative -mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition-colors",
                  active
                    ? "border-accent font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {/* Said in TEXT too, not colour alone — a red dot is invisible
                    to anyone who cannot see red. */}
                {tab.incomplete && (
                  <span
                    className="ml-1.5 inline-block size-1.5 rounded-full bg-destructive align-middle"
                    aria-label={t("tab_incomplete")}
                  />
                )}
              </button>
            );
          })}
        </div>
        {preview != null && onPreviewToggle && (
          <button
            type="button"
            onClick={onPreviewToggle}
            aria-pressed={showPreview}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={showPreview ? t("hide_preview") : t("show_preview")}
            title={showPreview ? t("hide_preview") : t("show_preview")}
          >
            {/* The icon shows the STATE, not the action: an open eye means the
                preview is open, a crossed-out eye means it is hidden. It was the
                other way round and read backwards — the tooltip still names the
                action, which is where an action belongs. */}
            {showPreview ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
          </button>
        )}
      </div>

      {/* ── FORM (left) + PREVIEW (right) ──────────────────────────────── */}
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1",
          showPreview && "lg:grid-cols-2",
        )}
      >
        <div className="flex min-h-0 flex-col border-border lg:border-r">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {children}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* ── BACK / NEXT ───────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={tabIndex === 0}
              onClick={() => onTabChange(tabs[tabIndex - 1].key)}
            >
              <ArrowLeft className="size-3.5" />
              {t("back")}
            </Button>
            {tabIndex === tabs.length - 1 && finalAction ? (
              // The last step's Next turns into the thing you came here to do.
              <Button
                type="button"
                size="sm"
                disabled={finalAction.disabled}
                onClick={finalAction.onClick}
              >
                {finalAction.label}
                <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={tabIndex === tabs.length - 1}
                onClick={() => onTabChange(tabs[tabIndex + 1].key)}
              >
                {t("next")}
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {showPreview && (
          <div className="min-h-0 overflow-y-auto bg-muted/20 p-5">{preview}</div>
        )}
      </div>
    </>
  );
}

// ── THE FIELD PRIMITIVES ───────────────────────────────────────────────────
//
// Lifted out of the engagement template builder unchanged. They were private to
// it, which is exactly why the other two builders used raw inputs and ended up
// looking like different products.

export function Fieldset({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-4 last:border-0">
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
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
          ? "border-accent bg-accent/5"
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
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
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
            on ? "bg-accent" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-background transition-[left]",
              on ? "left-[1.125rem]" : "left-0.5",
            )}
          />
        </button>
      </div>
      <div className={cn("pt-3", !on && "hidden")}>{children}</div>
    </div>
  );
}
