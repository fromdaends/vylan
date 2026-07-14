"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { X } from "lucide-react";

// The capabilities overlay: everything the assistant can do, expanded over
// the panel body when the header Info button is pressed. Covers the content
// area (header stays visible) on the same bg-card surface, and expands from
// the top-right corner where the Info button lives.
export function AssistantInfo({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Assistant");
  const tc = useTranslations("Common");

  const asks = [
    t("info_ask_1"),
    t("info_ask_2"),
    t("info_ask_3"),
    t("info_ask_4"),
  ];
  // Kept in lockstep with the REAL action list (ACTION_TYPES in
  // src/lib/engagement-chat/action-schemas.ts): approve/reject a document,
  // send a reminder, add/edit/remove checklist items, change due date /
  // assignee. info_do_4 ("validation rules") and info_do_6 ("quote setup")
  // described abilities the assistant never shipped — dropped (founder).
  const actions = [
    t("info_do_1"),
    t("info_do_2"),
    t("info_do_3"),
    t("info_do_5"),
  ];
  const limits = [
    t("info_limits_1"),
    t("info_limits_2"),
    t("info_limits_3"),
    t("info_limits_4"),
  ];

  return (
    <motion.div
      role="region"
      aria-label={t("info_title")}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: "top right" }}
      className="absolute inset-0 z-20 flex flex-col bg-card"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/40">
        <h2 className="text-[15px] font-semibold tracking-tight">
          {t("info_title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          aria-label={tc("close")}
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("info_intro")}
        </p>

        <Section title={t("info_ask_title")} hint={t("info_ask_hint")}>
          {asks.map((item) => (
            <Row key={item}>{item}</Row>
          ))}
        </Section>

        <Section title={t("info_do_title")} hint={t("info_do_hint")}>
          {actions.map((item) => (
            <Row key={item}>{item}</Row>
          ))}
        </Section>

        <Section title={t("info_limits_title")}>
          {limits.map((item) => (
            <Row key={item} muted>
              {item}
            </Row>
          ))}
        </Section>
      </div>
    </motion.div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80 font-semibold px-1">
        {title}
      </h3>
      {hint && (
        <p className="text-xs text-muted-foreground/80 mt-1 px-1 leading-relaxed">
          {hint}
        </p>
      )}
      <ul className="mt-2.5 space-y-1.5">{children}</ul>
    </section>
  );
}

function Row({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/40 px-3 py-2.5">
      <span
        aria-hidden
        className={
          "mt-1.5 size-1.5 shrink-0 rounded-full " +
          (muted ? "bg-muted-foreground/40" : "bg-accent")
        }
      />
      <span
        className={
          "text-sm leading-snug " +
          (muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {children}
      </span>
    </li>
  );
}
