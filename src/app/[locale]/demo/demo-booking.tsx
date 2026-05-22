"use client";

// cal.com booking step. Shows up after the prospect submits Step 3
// of the qualifying form. The cal.com inline embed is initialized
// with the contact name + email pre-filled so the prospect doesn't
// have to retype anything.
//
// Implementation notes:
//   - Uses @calcom/embed-react (already on the dep list for the
//     BookCallButton flow we shipped earlier).
//   - Cal link comes from NEXT_PUBLIC_CALCOM_LINK env var so the
//     founder can swap calendars without code changes.
//   - On booking success, we POST to markDemoBooked() so the row's
//     booked_at gets stamped and the founder is notified one more
//     time.
//   - Fallback: if the env var is missing or the embed module fails
//     to load, show a plain link to cal.com so the prospect can
//     still book.

import { useEffect } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";
import { useTranslations } from "next-intl";
import { markDemoBooked } from "@/app/actions/demo-request";

const NAMESPACE = "vylan-demo";

export function DemoBookingStep({
  demoId,
  contactName,
  email,
  locale,
  onBooked,
}: {
  demoId: string;
  contactName: string;
  email: string;
  locale: "fr" | "en";
  onBooked: () => void;
}) {
  const t = useTranslations("Demo");
  const calLink = process.env.NEXT_PUBLIC_CALCOM_LINK?.trim() || "";

  useEffect(() => {
    if (!calLink) return;
    let cancelled = false;
    (async () => {
      const cal = await getCalApi({ namespace: NAMESPACE });
      if (cancelled) return;
      cal("ui", {
        theme: "auto",
        hideEventTypeDetails: false,
        layout: "month_view",
      });
      // booking_successful_v2 fires once cal.com confirms the slot
      // has been reserved on the founder's calendar.
      cal("on", {
        action: "bookingSuccessful",
        callback: () => {
          // best-effort — if markDemoBooked fails we still show the
          // confirmation view to the prospect; the booking is real
          // on cal.com's side either way.
          if (demoId) {
            void markDemoBooked(demoId).catch((err) => {
              console.error("[demo-booking] markDemoBooked failed:", err);
            });
          }
          onBooked();
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [calLink, demoId, onBooked]);

  // Fallback: env var not set (e.g. preview deploy or local dev
  // without the link wired). Still let the prospect book via a
  // plain link so they don't end up stuck.
  if (!calLink) {
    return (
      <FallbackBooking
        firstName={firstName(contactName)}
        href="https://cal.com/vylan.app"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">
          {t("booking_heading")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("booking_subheading", { name: firstName(contactName) })}
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
        <Cal
          namespace={NAMESPACE}
          calLink={calLink}
          style={{ width: "100%", height: "640px", overflow: "scroll" }}
          config={{
            layout: "month_view",
            theme: "auto",
            // cal.com accepts these prefill keys at the URL level.
            name: contactName,
            email,
            // best-effort locale hint — cal.com falls back if not
            // supported.
            "metadata[locale]": locale,
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t("booking_fallback")}{" "}
        <a
          href={`https://cal.com/${calLink}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-foreground"
        >
          cal.com/{calLink}
        </a>
      </p>
    </div>
  );
}

function FallbackBooking({
  firstName: name,
  href,
}: {
  firstName: string;
  href: string;
}) {
  const t = useTranslations("Demo");
  return (
    <div className="space-y-5 text-center py-4">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        {t("booking_heading")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("booking_subheading", { name })}
      </p>
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-6">
        <p className="text-sm text-muted-foreground mb-4">
          {t("booking_fallback")}
        </p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {href.replace(/^https?:\/\//, "")}
        </a>
      </div>
    </div>
  );
}

function firstName(label: string): string {
  return label.split(/\s+/)[0] ?? "";
}
