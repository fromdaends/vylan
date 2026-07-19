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
  const t = await getTranslations({ locale, namespace: "Privacy" });
  return { title: `${t("title")} · Vylan` };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Privacy");

  const sections: LegalSection[] = [
    { h: t("h_overview"), body: t("p_overview") },
    { h: t("h_what_we_collect"), body: t("p_what_we_collect"), list: true },
    { h: t("h_why"), body: t("p_why"), list: true },
    { h: t("h_ai"), body: t("p_ai") },
    { h: t("h_law25"), body: t("p_law25") },
    { h: t("h_residency"), body: t("p_residency") },
    { h: t("h_sharing"), body: t("p_sharing") },
    { h: t("h_subprocessors"), body: t("p_subprocessors"), list: true },
    { h: t("h_security"), body: t("p_security") },
    { h: t("h_retention"), body: t("p_retention") },
    { h: t("h_rights"), body: t("p_rights"), list: true },
    { h: t("h_breach"), body: t("p_breach") },
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
