import { getTranslations } from "next-intl/server";
import { PortalDoorLink } from "@/components/portal/portal-door-link";

// Canopy's "Client View" tab — what the other side of this engagement sees.
//
// ⚠️ IT IS A DOOR, NOT A COPY. Vylan already HAS the client's view: the portal,
// at /r/<token>, which is the real page the client is looking at right now.
// Rebuilding it here as a preview would be a second rendering of the client
// experience that drifts from the first — and it would drift in the worst
// possible direction, because the whole point of the tab is to answer "what do
// they actually see?" A preview that is subtly wrong answers it falsely.
//
// So this opens the real thing. The only cost is a new tab; the benefit is
// that the answer cannot be out of date.
//
// Before the engagement is sent there is nothing to look at — no token, no
// portal — and the panel says that rather than offering a dead link.

export async function EngagementClientViewPanel({
  magicToken,
  sent,
}: {
  engagementId: string;
  magicToken: string | null;
  sent: boolean;
}) {
  const t = await getTranslations("Engagements");

  if (!sent || !magicToken) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">
          {t("client_view_not_sent")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-6 text-center">
      <p className="text-sm text-muted-foreground">{t("client_view_intro")}</p>
      {/* The warning travels with the link — see PortalDoorLink for why it is
          not this component's to remember. */}
      <PortalDoorLink
        token={magicToken}
        label={t("client_view_open")}
        warning={t("client_view_warning")}
      />
    </div>
  );
}
