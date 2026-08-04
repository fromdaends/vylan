"use client";

// Turns the ?calendar= flag the OAuth callback lands with into one toast, then
// scrubs it from the URL.
//
// Same shape as the filing connector's provider-card-actions toast, for the
// same reason: the callback is a server redirect and cannot raise a toast
// itself, so it hands the outcome over in the query string and the page says
// it out loud once.

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function CalendarReturnToast() {
  const t = useTranslations("Dashboard");
  const params = useSearchParams();
  const router = useRouter();
  // A ref, not state: React may run this effect twice in development and a
  // duplicate toast is a bug the user can see.
  const fired = useRef(false);

  useEffect(() => {
    const flag = params.get("calendar");
    if (!flag || fired.current) return;
    fired.current = true;

    if (flag === "connected") {
      toast.success(t("calendar_toast_connected"));
    } else if (flag === "denied") {
      // They pressed Cancel on Google's screen. Not an error — say so calmly.
      toast(t("calendar_toast_denied"));
    } else {
      toast.error(t("calendar_toast_failed"));
    }
    // Drop the flag so a refresh doesn't re-announce a week-old connection.
    router.replace("/dashboard", { scroll: false });
  }, [params, router, t]);

  return null;
}
