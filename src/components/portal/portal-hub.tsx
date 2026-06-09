"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// The two-card portal hub: "To sign" and "Your documents". Purely
// presentational — the parent shell computes each card's honest status line +
// tone and what to do on tap. Matches the portal's surface (rounded card, faint
// hairline, soft shadow, electric-blue accent) rather than inventing a new look.

export type HubTone = "accent" | "warning" | "success" | "muted";

export type HubCardData = {
  key: string;
  icon: LucideIcon;
  title: string;
  // The honest one-line status, e.g. "2 to sign" / "1 needs attention".
  line: string;
  tone: HubTone;
  onSelect: () => void;
};

const TONE_ICON: Record<HubTone, string> = {
  accent: "bg-accent/15 text-accent",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  muted: "bg-muted text-muted-foreground",
};

const TONE_LINE: Record<HubTone, string> = {
  accent: "text-accent",
  warning: "text-warning",
  success: "text-success",
  muted: "text-muted-foreground",
};

export function PortalHub({ cards }: { cards: HubCardData[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <HubCard key={card.key} card={card} />
      ))}
    </section>
  );
}

function HubCard({ card }: { card: HubCardData }) {
  const { icon: Icon, title, line, tone, onSelect } = card;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-border/60 bg-card p-5 text-left shadow-sm transition-all duration-200 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          TONE_ICON[tone],
        )}
        aria-hidden
      >
        <Icon className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </span>
        <span className={cn("mt-0.5 block text-sm", TONE_LINE[tone])}>
          {line}
        </span>
      </span>
      <ChevronRight
        className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}
