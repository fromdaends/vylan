"use client";

import { useEffect, type ReactNode } from "react";
import { getCalApi } from "@calcom/embed-react";
import { Button } from "@/components/ui/button";

// Founder's public Cal.com link. Bookings go to whatever calendar is
// connected on Cal.com's side (Apple Calendar in our case). Update
// here if the link ever changes.
export const CAL_LINK = "vylan.app";
const CAL_NAMESPACE = "book-call";

// Opens the Cal.com booking flow as a centered modal overlay on top
// of the current page (no redirect / new tab). The cal.com bootstrap
// is initialized once per page mount via getCalApi.
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
  useEffect(() => {
    (async () => {
      const cal = await getCalApi({ namespace: CAL_NAMESPACE });
      cal("ui", {
        theme: "auto",
        hideEventTypeDetails: false,
        layout: "month_view",
      });
    })();
  }, []);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      data-cal-namespace={CAL_NAMESPACE}
      data-cal-link={CAL_LINK}
      data-cal-config='{"layout":"month_view"}'
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
      className={
        "text-primary hover:underline font-medium " + (className ?? "")
      }
    >
      {children}
    </button>
  );
}
