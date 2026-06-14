import { getTranslations } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { Step1Form } from "./step1-form";
import { Step2Form } from "./step2-form";
import { Step3Form } from "./step3-form";
import { assertLocale } from "@/lib/locale";

const TOTAL = 3;

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  const sp = await searchParams;
  const requested = Number(sp.step ?? "1");
  const step =
    Number.isFinite(requested) && requested >= 1 && requested <= TOTAL
      ? (requested as 1 | 2 | 3)
      : 1;

  const firm = await getCurrentFirm();
  const t = await getTranslations("Onboarding");

  return (
    <div className="space-y-6">
      <Progress
        step={step}
        total={TOTAL}
        ariaLabel={t("progress_aria", { step, total: TOTAL })}
      />
      {step === 1 && (
        <Step1Form
          locale={locale}
          initialName={firm?.name ?? ""}
          initialColor={firm?.brand_color ?? "#1e293b"}
        />
      )}
      {step === 2 && (
        <Step2Form
          locale={locale}
          initialTimezone={firm?.timezone ?? "America/Toronto"}
          initialLocaleDefault={firm?.locale_default ?? "fr"}
        />
      )}
      {step === 3 && <Step3Form locale={locale} />}
    </div>
  );
}

function Progress({
  step,
  total,
  ariaLabel,
}: {
  step: number;
  total: number;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2" aria-label={ariaLabel}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={
            i < step
              ? "h-1.5 flex-1 rounded-full bg-primary"
              : "h-1.5 flex-1 rounded-full bg-muted"
          }
        />
      ))}
    </div>
  );
}
