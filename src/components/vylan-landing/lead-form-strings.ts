import type { getTranslations } from "next-intl/server";
import type { LeadFormStrings } from "./lead-form";

// Assemble the lead-form strings from the "Vylan" translator. Shared by
// the landing + manifesto pages (both render the lead form). The `t`
// passed in is already resolved server-side.
export function buildLeadFormStrings(
  t: Awaited<ReturnType<typeof getTranslations<"Vylan">>>,
): LeadFormStrings {
  return {
    title: t("form_title"),
    sub: t("form_sub"),
    emailPlaceholder: t("form_email"),
    firmPlaceholder: t("form_firm"),
    practiceLabel: t("form_practice_label"),
    practiceOptions: [
      { value: "solo", label: t("practice_solo") },
      { value: "small_firm", label: t("practice_small_firm") },
      { value: "mid_size", label: t("practice_mid_size") },
      { value: "tax_advisory", label: t("practice_tax_advisory") },
      { value: "other", label: t("practice_other") },
    ],
    clientsLabel: t("form_clients_label"),
    clientsOptions: [
      { value: "under_25", label: t("clients_under_25") },
      { value: "25_100", label: t("clients_25_100") },
      { value: "100_500", label: t("clients_100_500") },
      { value: "500_plus", label: t("clients_500_plus") },
    ],
    notesPlaceholder: t("form_notes"),
    submit: t("form_submit"),
    submitting: t("form_submitting"),
    doneTitle: t("form_done_title"),
    doneBody: t("form_done_body"),
    errorGeneric: t("form_error"),
    errorRate: t("form_error_rate"),
  };
}
