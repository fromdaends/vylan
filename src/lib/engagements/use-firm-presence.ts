"use client";

import { useEffect, useState } from "react";
import { type RawPresenceState } from "@/lib/engagements/presence";

// The firm's single presence channel. Every surface that wants to show "who is
// looking at what" mounts this hook — the engagement page, the engagement list,
// and anything added later — and they all share one socket and one topic.
//
// `onEngagementId` is what YOU are looking at right now: the engagement's id on
// a detail page, null anywhere else. It goes out in the payload so other people
// can draw your face on the right row. Passing null still subscribes — the list
// needs to RECEIVE presence without claiming to be on any one job.
//
// Returns the raw channel state; the reducers in presence.ts turn it into
// people. Kept apart so the socket lifecycle and the display rules can be
// changed independently, and so the rules stay testable without a browser.
export function useFirmPresence({
  firmId,
  viewerId,
  onEngagementId = null,
}: {
  firmId: string;
  viewerId: string;
  onEngagementId?: string | null;
}): RawPresenceState | null {
  const [state, setState] = useState<RawPresenceState | null>(null);

  useEffect(() => {
    if (!firmId || !viewerId) return;
    // The Supabase browser client is loaded LAZILY, inside the effect: this
    // hook is the only reason @supabase/supabase-js (a ~220KB chunk) sat in
    // the critical first-load path of every page that shows presence avatars.
    // As a dynamic import it hydrates first and the presence socket follows a
    // beat later — invisible for a feature whose data is people-arriving.
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      const { getBrowserSupabase } = await import("@/lib/supabase/client");
      if (cancelled) return;
      const supabase = getBrowserSupabase();
      const channel = supabase.channel(`firm-presence:${firmId}`, {
        // Stated explicitly rather than relying on a .on("presence") binding
        // happening to be registered before .subscribe(). Realtime only turns
        // presence on if a binding exists at subscribe time, so a refactor that
        // reorders those two lines would silently disable this with no error.
        config: { presence: { key: viewerId, enabled: true } },
      });

      const sync = () => setState(channel.presenceState());
      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // An id and an engagement id. Nothing else may go in here — the
            // channel is public. See the note in presence.ts.
            void channel.track({ id: viewerId, e: onEngagementId });
          }
        });

      cleanup = () => {
        // untrack first: the server emits the `leave` diff on the same
        // round-trip, so colleagues see you go immediately instead of waiting
        // out a ~25s heartbeat. removeChannel alone would rely on that timeout.
        void channel.untrack().finally(() => {
          void supabase.removeChannel(channel);
        });
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // onEngagementId is in the deps on purpose: moving from one engagement to
    // another has to re-track, or your face stays on the row you left.
  }, [firmId, viewerId, onEngagementId]);

  return state;
}
