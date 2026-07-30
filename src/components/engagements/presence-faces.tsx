"use client";

import { useTranslations } from "next-intl";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  presenceColor,
  splitPresence,
  type PresentPerson,
} from "@/lib/engagements/presence";

// The avatar row itself — pure presentation, no socket. Both surfaces use it:
// the engagement page at full size beside the title, and each row of the
// engagements list at "compact", so the two can never drift into looking like
// different features.
//
// ── THE LOOK ─────────────────────────────────────────────────────────────────
//
// Overlapping faces, each in its own stable colour, each ringed in the page
// background so the overlap reads as a stack instead of a smear. Colour is the
// point: a row of identical grey circles tells you a number, a row of coloured
// ones tells you WHO without reading. The colours are the app's own icon
// tokens, already tuned for light and dark.
//
// One animation, not five: a slow breath on the live dot, and only at full
// size. On a list of forty rows a pulsing dot per row would be a disco, so
// compact drops it — the faces alone are the signal there, and they are already
// unusual enough on a list to notice. Everything stops under
// prefers-reduced-motion; the ring and the colour survive, so nothing carrying
// meaning depends on movement.
export function PresenceFaces({
  people,
  compact = false,
}: {
  people: PresentPerson[];
  // List rows: smaller faces, fewer of them, no pulse.
  compact?: boolean;
}) {
  const t = useTranslations("Engagements");
  if (people.length === 0) return null;

  const size = compact ? 16 : 22;
  const { shown, overflow } = splitPresence(people, compact ? 3 : 4);

  return (
    <TooltipProvider delayDuration={150}>
      <span
        className={compact ? "inline-flex items-center" : "inline-flex items-center gap-2"}
        aria-label={t("presence_viewing", { count: people.length })}
      >
        {!compact && (
          // The live dot. The one moving thing, and it earns its place: without
          // it a coloured face is indistinguishable from a static avatar of the
          // assignee sitting next to it.
          <span className="relative inline-flex size-1.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-icon-emerald opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-icon-emerald" />
          </span>
        )}

        <span className={compact ? "flex items-center -space-x-1" : "flex items-center -space-x-1.5"}>
          {shown.map((p) => (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <span
                  // tabIndex so the name is reachable without a mouse — Radix
                  // opens the tooltip on focus, which is also what gives touch
                  // devices a way in, since hover does not exist there.
                  tabIndex={0}
                  className="relative inline-flex rounded-full ring-2 ring-background transition-transform duration-200 ease-out hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span
                    className="inline-flex rounded-full p-[1.5px]"
                    style={{ backgroundColor: `var(--${presenceColor(p.id)})` }}
                  >
                    <AvatarInitials
                      name={p.name}
                      size={size}
                      className="ring-1 ring-background"
                    />
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("presence_person_viewing", { name: p.name })}
              </TooltipContent>
            </Tooltip>
          ))}

          {overflow > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  style={{ height: size + 3, minWidth: size + 3 }}
                  className="relative inline-flex items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground ring-2 ring-background transition-transform duration-200 ease-out hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  +{overflow}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {people
                  .slice(shown.length)
                  .map((p) => p.name)
                  .join(", ")}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </span>
    </TooltipProvider>
  );
}
