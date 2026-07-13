"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

// Tab switch for the engagement body: Checklist (default) <-> Signatures, so the
// page shows one section at a time instead of stacking both. LAYOUT ONLY — the
// checklist and signatures content (and all their controls) are rendered by the
// server and passed in as nodes; this just toggles which panel is visible. Both
// stay mounted (hidden, not unmounted) so nothing reloads and no row state (an
// open reject dialog, an in-flight action) is lost when switching tabs.
//
// Underline tabs, deliberately not the boxed/segmented style, to read as a
// natural part of the page rather than a heavy widget.
export function EngagementTabs({
  checklistCount,
  signaturesCount,
  finalCount,
  showSignatures,
  showFinal,
  checklistControls,
  signaturesControls,
  finalControls,
  checklist,
  signatures,
  final,
}: {
  checklistCount: number;
  signaturesCount: number;
  finalCount: number;
  // False only when signatures don't apply (not live AND none exist): then it's
  // a plain checklist with no tab bar, matching the old single-section layout.
  showSignatures: boolean;
  // Whether the Final documents tab applies (finals exist OR the engagement is
  // live/complete, i.e. there's work to deliver).
  showFinal: boolean;
  checklistControls: ReactNode;
  signaturesControls: ReactNode;
  finalControls: ReactNode;
  checklist: ReactNode;
  signatures: ReactNode;
  final: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const [active, setActive] = useState<"checklist" | "signatures" | "final">(
    "checklist",
  );

  // If the selected tab is no longer shown (e.g. the Signatures tab disappears
  // when a signature-free engagement is marked complete, while `active` is still
  // "signatures" after the in-place refresh), fall back to the checklist so the
  // body is never blank.
  const effectiveActive =
    (active === "signatures" && !showSignatures) ||
    (active === "final" && !showFinal)
      ? "checklist"
      : active;

  // No extra tabs apply → plain single-section checklist, no tab bar.
  if (!showSignatures && !showFinal) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
          <h2 className="px-1 py-2 text-base font-semibold tracking-tight text-foreground">
            {t("checklist")}{" "}
            <span className="font-normal text-muted-foreground">
              ({checklistCount})
            </span>
          </h2>
          <div className="flex items-center gap-2 pb-1.5">
            {checklistControls}
          </div>
        </div>
        {checklist}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
        <div className="flex items-center gap-4" role="tablist">
          <TabButton
            active={effectiveActive === "checklist"}
            onClick={() => setActive("checklist")}
            label={t("checklist")}
            count={checklistCount}
          />
          {showSignatures && (
            <TabButton
              active={effectiveActive === "signatures"}
              onClick={() => setActive("signatures")}
              label={t("signatures")}
              count={signaturesCount}
            />
          )}
          {showFinal && (
            <TabButton
              active={effectiveActive === "final"}
              onClick={() => setActive("final")}
              label={t("final_documents")}
              count={finalCount}
            />
          )}
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          {effectiveActive === "checklist"
            ? checklistControls
            : effectiveActive === "signatures"
              ? signaturesControls
              : finalControls}
        </div>
      </div>

      <div hidden={effectiveActive !== "checklist"}>{checklist}</div>
      {showSignatures && (
        <div hidden={effectiveActive !== "signatures"}>{signatures}</div>
      )}
      {showFinal && (
        <div hidden={effectiveActive !== "final"}>{final}</div>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        // -mb-px so the active underline sits on top of the bar's bottom border.
        "-mb-px border-b-2 px-1 py-2 text-base font-semibold tracking-tight transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}{" "}
      <span
        className={cn(
          "font-normal",
          active ? "text-muted-foreground" : "text-muted-foreground/70",
        )}
      >
        ({count})
      </span>
    </button>
  );
}
