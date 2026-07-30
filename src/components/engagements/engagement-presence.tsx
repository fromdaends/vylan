"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  presenceColor,
  presentOthers,
  splitPresence,
  type PresenceRoster,
  type RawPresenceState,
} from "@/lib/engagements/presence";

// "Who else has this open right now" — the live avatar row beside an
// engagement's title, the convention Google Docs, Figma, Notion and Teams all
// share. It answers the question the removed "Worked on by" strip answered
// badly: that one was a permanent record of everyone who had ever touched the
// job, readable by colleagues forever. This is the live version — it exists
// while someone is looking and vanishes when they leave, which is the only
// form of the question that helps ("don't both edit this at once") rather than
// the form that watches people.
//
// VIEWING, not editing. Vylan has no collaborative editing, so there is no
// cursor to colour and no lock to take. The row is informational.
//
// Built on Supabase Realtime Presence: no table, no migration, no dashboard
// switch. The reducer that decides what to draw lives in lib/engagements/
// presence.ts, and the roster filter it applies is load-bearing — read the
// comment there before changing anything here.
//
// ── THE LOOK ─────────────────────────────────────────────────────────────────
//
// Overlapping faces, each in its own stable colour, each ringed in the page
// background so the overlap reads as a stack instead of a smear. Colour is the
// point: a row of identical grey circles tells you a number, a row of coloured
// ones tells you WHO without reading. The colours are the app's own icon
// tokens, already tuned for light and dark.
//
// One animation, not five: a slow breath on the live dot. The faces themselves
// only lift on hover, and both stop under prefers-reduced-motion — the ring and
// the dot are still there, so nothing that carries meaning depends on movement.
export function EngagementPresence({
  engagementId,
  viewerId,
  roster,
}: {
  engagementId: string;
  viewerId: string;
  // Server-rendered and RLS-scoped. The ONLY source of names — a presence
  // payload never carries one.
  roster: PresenceRoster;
}) {
  const t = useTranslations("Engagements");
  const [state, setState] = useState<RawPresenceState | null>(null);

  useEffect(() => {
    if (!viewerId) return;
    const supabase = getBrowserSupabase();
    const channel = supabase.channel(`engagement-presence:${engagementId}`, {
      // `enabled` stated explicitly rather than relying on the fact that a
      // .on("presence") binding below happens to be registered before
      // .subscribe(). Realtime only turns presence on if a binding already
      // exists at subscribe time, so a refactor that reorders these two lines
      // would silently disable the whole feature with no error anywhere.
      config: { presence: { key: viewerId, enabled: true } },
    });

    const sync = () => setState(channel.presenceState());
    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Nothing but the id. See the roster-filter note in presence.ts:
          // this channel is public, so anything put here is public too.
          void channel.track({ id: viewerId });
        }
      });

    return () => {
      // untrack first: the server emits the `leave` diff on the same
      // round-trip, so colleagues see you go immediately instead of waiting
      // out a ~25s heartbeat. removeChannel alone would rely on that timeout.
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel);
      });
    };
  }, [engagementId, viewerId]);

  const people = presentOthers(state, viewerId, roster);
  // Renders nothing when you are alone, which is almost always. A row that is
  // usually an empty labelled container is worse than no row.
  if (people.length === 0) return null;

  const { shown, overflow } = splitPresence(people);

  return (
    <TooltipProvider delayDuration={150}>
      <span
        className="inline-flex items-center gap-2"
        aria-label={t("presence_viewing", { count: people.length })}
      >
        {/* The live dot. The one moving thing here, and it earns it: without
            it a coloured face is indistinguishable from a static avatar of the
            assignee. Stops under prefers-reduced-motion (globals.css), where
            the solid dot still reads as "live". */}
        <span className="relative inline-flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-icon-emerald opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-icon-emerald" />
        </span>

        {/* -space-x pulls the faces into an overlapping stack. The ring is the
            PAGE background, not a border, so the overlap reads as depth rather
            than as two circles fighting. */}
        <span className="flex items-center -space-x-1.5">
          {shown.map((p) => (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <span
                  // tabIndex so the name is reachable without a mouse — Radix
                  // opens the tooltip on focus, which is also what gives touch
                  // devices a way in, since hover does not exist there.
                  tabIndex={0}
                  style={{ ["--ring-color" as string]: `var(--${presenceColor(p.id)})` }}
                  className="relative inline-flex rounded-full ring-2 ring-background transition-transform duration-200 ease-out hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span
                    className="inline-flex rounded-full p-[1.5px]"
                    style={{ backgroundColor: "var(--ring-color)" }}
                  >
                    <AvatarInitials
                      name={p.name}
                      size={22}
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
                  className="relative inline-flex h-[25px] min-w-[25px] items-center justify-center rounded-full bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-2 ring-background transition-transform duration-200 ease-out hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
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
