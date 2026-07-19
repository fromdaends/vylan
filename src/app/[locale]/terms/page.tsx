import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand";
import { assertLocale } from "@/lib/locale";
import { LegalDoc, type LegalSection } from "@/components/vylan-landing/legal-doc";

export const dynamic = "force-static";

const LAST_UPDATED = "2026-07-19";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Terms" });
  return { title: `${t("title")} · Vylan` };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Terms");

  const sections: LegalSection[] = [
    { h: t("h_acceptance"), body: t("p_acceptance") },
    { h: t("h_service"), body: t("p_service") },
    { h: t("h_accounts"), body: t("p_accounts") },
    { h: t("h_subscription"), body: t("p_subscription") },
    { h: t("h_data"), body: t("p_data") },
    { h: t("h_acceptable_use"), body: t("p_acceptable_use") },
    { h: t("h_intellectual"), body: t("p_intellectual") },
    { h: t("h_termination"), body: t("p_termination") },
    { h: t("h_warranty"), body: t("p_warranty") },
    { h: t("h_law"), body: t("p_law") },
    { h: t("h_contact"), body: t("p_contact", { email: brand.supportEmail }) },
  ];

  return (
    <LegalDoc
      locale={locale}
      title={t("title")}
      updated={t("updated", { date: LAST_UPDATED })}
      sections={sections}
    />
  );
}
