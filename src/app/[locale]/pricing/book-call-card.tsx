"use client";

import { useEffect, type ReactNode } from "react";
import { getCalApi } from "@calcom/embed-react";
import { CAL_LINK } from "@/components/booking/book-call-button";

const CAL_NAMESPACE = "book-call";

// Card variant of BookCallButton — same Cal.com link, but rendered as
// a full clickable card matching the "Try out a demo" card next to
// it. The whole card surface is the trigger; clicking anywhere on it
// opens the Cal.com booking modal.
export function BookCallCard({
  icon,
  heading,
  body,
  cta,
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  cta: string;
}) {
  useEffect(() => {
    (async () => {
      const cal = await getCalApi({ namespace: CAL_NAMESPACE });
      cal("ui", { theme: "auto", layout: "month_view" });
    })();
  }, []);
  return (
    <button
      type="button"
      data-cal-namespace={CAL_NAMESPACE}
      data-cal-link={CAL_LINK}
      data-cal-config='{"layout":"month_view"}'
      className="group rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-foreground/20 hover:bg-secondary/30"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        {icon}
      </span>
      <h3 className="mt-3 font-medium">{heading}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <span className="mt-3 inline-block text-sm font-medium text-primary group-hover:underline">
        {cta}
      </span>
    </button>
  );
}
