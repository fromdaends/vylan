"use client";

import { useFirmPresence } from "@/lib/engagements/use-firm-presence";
import {
  presentOthers,
  type PresenceRoster,
} from "@/lib/engagements/presence";
import { PresenceFaces } from "./presence-faces";

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
// The socket lives in useFirmPresence (one channel for the whole firm, shared
// with the engagements list), the display rules in presence.ts, the pixels in
// PresenceFaces. This component is just the join: tell the firm channel which
// engagement I am on, and draw whoever else says the same.
export function EngagementPresence({
  firmId,
  engagementId,
  viewerId,
  roster,
}: {
  firmId: string;
  engagementId: string;
  viewerId: string;
  // Server-rendered and RLS-scoped. The ONLY source of names — a presence
  // payload never carries one.
  roster: PresenceRoster;
}) {
  const state = useFirmPresence({
    firmId,
    viewerId,
    onEngagementId: engagementId,
  });
  // presentOthers ignores which engagement each person is on, so filter to this
  // one first: on a firm-wide channel, everybody is "present".
  const here = state
    ? Object.fromEntries(
        Object.entries(state).filter(([, metas]) =>
          (Array.isArray(metas) ? metas : []).some(
            (m) => (m as { e?: unknown })?.e === engagementId,
          ),
        ),
      )
    : null;

  // Renders nothing when you are alone, which is almost always. A row that is
  // usually an empty labelled container is worse than no row.
  return <PresenceFaces people={presentOthers(here, viewerId, roster)} />;
}
