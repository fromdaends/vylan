"use client";

// The portal's embedded-signing opener — ONE hook for every surface that lets
// the client sign (the checklist's SignatureItemCard, and the proposal screen
// where signing the engagement letter IS accepting). Extracted from
// SignatureItemCard so the two can never drift: same endpoint, same guards,
// same optimistic completion. The webhook stays the authoritative writer; the
// in-session `completed` event only updates local state and refreshes.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logPortalActivity } from "@/lib/portal/activity-log";
import {
  loadSignWellEmbed,
  getSignWellEmbedCtor,
} from "@/components/signwell/embed-loader";

export type SigningLocalState =
  | "idle"
  | "opening"
  | "open"
  | "submitted"
  | "error";

export function usePortalSigning(opts: {
  token: string;
  itemId: string;
  /** Human label for the activity log ("Engagement letter", the item name). */
  activityLabel: string;
  /** Fired on the in-session completed event, after local state flips. */
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const [local, setLocal] = useState<SigningLocalState>("idle");
  const busy = local === "opening" || local === "open";

  async function openSigning() {
    setLocal("opening");
    // The intent to sign is a deliberate client click; the authoritative
    // "signed" is logged by the SignWell webhook.
    logPortalActivity(opts.token, "client_opened_signature", {
      name: opts.activityLabel,
      ref: opts.itemId,
    });
    try {
      const res = await fetch(
        `/api/portal/signwell/embed?token=${encodeURIComponent(
          opts.token,
        )}&item_id=${encodeURIComponent(opts.itemId)}`,
      );
      if (!res.ok) throw new Error("fetch_failed");
      const body = (await res.json()) as {
        embedded_signing_url?: string;
        status?: string;
      };
      // Already signed elsewhere, or not ready.
      if (body.status === "completed") {
        setLocal("submitted");
        opts.onCompleted?.();
        router.refresh();
        return;
      }
      if (!body.embedded_signing_url) throw new Error("no_url");

      await loadSignWellEmbed();
      const Ctor = getSignWellEmbedCtor();
      if (!Ctor) throw new Error("no_ctor");

      const embed = new Ctor({
        url: body.embedded_signing_url,
        events: {
          completed: () => {
            setLocal("submitted");
            opts.onCompleted?.();
            // Let the webhook flip the authoritative status; refresh so the
            // server-rendered view catches up.
            router.refresh();
          },
          declined: () => setLocal("idle"),
          closed: () => setLocal((s) => (s === "submitted" ? s : "idle")),
          error: () => setLocal("error"),
        },
      });
      setLocal("open");
      embed.open();
    } catch {
      setLocal("error");
    }
  }

  return { local, busy, openSigning };
}
