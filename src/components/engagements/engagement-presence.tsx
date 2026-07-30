"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
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
    // persistSession/autoRefreshToken/detectSessionInUrl are all off: this is
    // the app's first browser-side Supabase client, the session cookies are
    // HttpOnly so it can never hold one anyway, and detectSessionInUrl would
    // otherwise have this component sniffing every URL it mounts under —
    // including on a page that sits one navigation from the two auth
    // confirmation routes.
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
    <span
      className="inline-flex items-center gap-1 align-middle"
      aria-label={t("presence_viewing", { count: people.length })}
    >
      {shown.map((p) => (
        <span
          key={p.id}
          title={t("presence_person_viewing", { name: p.name })}
          className="inline-block rounded-full ring-2 ring-background"
        >
          <AvatarInitials name={p.name} size={22} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={people
            .slice(shown.length)
            .map((p) => p.name)
            .join(", ")}
          className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-secondary px-1.5 text-[11px] font-medium text-muted-foreground ring-2 ring-background"
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
