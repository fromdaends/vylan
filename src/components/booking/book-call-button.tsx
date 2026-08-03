"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Founder's public Cal.com link. Bookings go to whatever calendar is
// connected on Cal.com's side (Apple Calendar in our case). Update
// here if the link ever changes.
export const CAL_LINK = "vylan.app";
const CAL_NAMESPACE = "book-call";

// Loads the Cal.com embed ON CLICK and opens the booking modal
// programmatically. It used to import @calcom/embed-react statically and
// initialize on MOUNT — which injected Cal's third-party embed.js into every
// page that merely RENDERED one of these buttons (the trial banner puts one on
// every app page for trial firms, the billing page for everyone) whether or
// not anyone ever booked. Now nothing Cal-related is fetched until the click.
async function openCalModal(): Promise<void> {
  const { getCalApi } = await import("@calcom/embed-react");
  const cal = await getCalApi({ namespace: CAL_NAMESPACE });
  cal("ui", {
    theme: "auto",
    hideEventTypeDetails: false,
    layout: "month_view",
  });
  cal("modal", {
    calLink: CAL_LINK,
    config: { layout: "month_view" },
  });
}

// Opens the Cal.com booking flow as a centered modal overlay on top
// of the current page (no redirect / new tab).
export function BookCallButton({
  label,
  icon,
  variant = "default",
  size = "default",
  className,
}: {
  label: ReactNode;
  icon?: ReactNode;
  variant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={loading}
      onClick={async () => {
        // The first click pays the embed download (~a beat on a normal
        // connection); the button dims while it loads so the click visibly
        // took. Later clicks reuse the loaded embed and open instantly.
        setLoading(true);
        try {
          await openCalModal();
        } finally {
          setLoading(false);
        }
      }}
    >
      {icon}
      {label}
    </Button>
  );
}

// Plain link version — same Cal target, styled as a text link rather
// than a button. Used where we need an inline anchor inside prose
// (e.g. the /billing placeholder body).
export function BookCallLink({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void openCalModal()}
      className={
        "text-primary hover:underline font-medium " + (className ?? "")
      }
    >
      {children}
    </button>
  );
}
