"use client";

// Cal.com booking step for the blue landing flow. Same integration as
// the /demo page's DemoBookingStep (getCalApi + inline embed + the
// markDemoBooked callback), restyled for the marketing page. Kept as a
// separate component so the blue UI doesn't depend on the light-themed
// shadcn wrapper.

import { useEffect } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";
import { useTranslations } from "next-intl";
import { markDemoBooked } from "@/app/actions/demo-request";

const NAMESPACE = "vylan-landing-demo";

function firstName(label: string): string {
  return label.split(/\s+/)[0] ?? "";
}

export function VylanBooking({
  demoId,
  contactName,
  email,
  locale,
  onBack,
  onBooked,
}: {
  demoId: string;
  contactName: string;
  email: string;
  locale: "fr" | "en";
  onBack: () => void;
  onBooked: () => void;
}) {
  const t = useTranslations("Demo");
  const calLink = process.env.NEXT_PUBLIC_CALCOM_LINK?.trim() || "";
  const fname = firstName(contactName);

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
      cal("on", {
        action: "bookingSuccessful",
        callback: () => {
          if (demoId) {
            void markDemoBooked(demoId).catch((err) => {
              console.error("[vylan-booking] markDemoBooked failed:", err);
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

  // Fallback when the cal link isn't configured (preview / local dev):
  // still let the prospect book via a plain link.
  if (!calLink) {
    return (
      <>
        <button className="vy-back-btn" type="button" onClick={onBack}>
          ← {t("back")}
        </button>
        <h2>{t("booking_heading")}</h2>
        <p className="vy-form-sub">{t("booking_subheading", { name: fname })}</p>
        <a
          className="vy-btn"
          href="https://cal.com/vylan.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginTop: "18px" }}
        >
          cal.com/vylan.app
        </a>
      </>
    );
  }

  return (
    <>
      <button className="vy-back-btn" type="button" onClick={onBack}>
        ← {t("back")}
      </button>
      <h2>{t("booking_heading")}</h2>
      <p className="vy-form-sub">{t("booking_subheading", { name: fname })}</p>
      <div className="vy-booking-cal">
        <Cal
          namespace={NAMESPACE}
          calLink={calLink}
          style={{ width: "100%", height: "620px", overflow: "scroll" }}
          config={{
            layout: "month_view",
            theme: "auto",
            name: contactName,
            email,
            "metadata[locale]": locale,
          }}
        />
      </div>
      <p className="vy-booking-fallback">
        {t("booking_fallback")}{" "}
        <a
          href={`https://cal.com/${calLink}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          cal.com/{calLink}
        </a>
      </p>
    </>
  );
}
