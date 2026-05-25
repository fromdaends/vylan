"use client";

// 3-step demo qualifying form. The point: capture the prospect's
// firm size + client volume + current tool BEFORE the sales call so
// the founder can quote intelligently. Save progressively so a
// partial fill still captures the email.
//
// Phase 2: builds the form + wires it to saveDemoStep.
// Phase 4: replaces the placeholder "booked" view with the cal.com
//          embed.

import { useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  Sparkles,
} from "lucide-react";
import {
  DemoStep1Schema,
  DemoStep2Schema,
  DemoStep3Schema,
  PROVINCES,
  type Province,
} from "@/app/actions/demo-request.schema";
import { saveDemoStep } from "@/app/actions/demo-request";
import { DemoBookingStep } from "./demo-booking";

type Locale = "fr" | "en";

type Step1State = {
  contact_name: string;
  email: string;
  firm_name: string;
};

type Step2State = {
  firm_size: "" | "solo" | "2_5" | "6_15" | "16_plus";
  client_volume: "" | "under_25" | "25_100" | "100_300" | "300_plus";
  current_tool:
    | ""
    | "manual_email"
    | "taxdome"
    | "karbon"
    | "other_software"
    | "nothing";
  current_tool_other: string;
};

type Step3State = {
  phone: string;
  province: Province | "";
  preferred_language: Locale;
  marketing_opt_in: boolean;
};

// View state machine for the whole flow:
//   1 / 2 / 3       — the three form steps
//   "next-steps"    — the choice screen that follows step 3: try the
//                     demo now (primary) or book a call (secondary)
//   "booking"       — the cal.com inline embed (reached from
//                     next-steps via "Book a meeting")
//   "booked"        — confirmation; also nudges the prospect to try
//                     the demo if they haven't already
type View = 1 | 2 | 3 | "next-steps" | "booking" | "booked";

const FIRM_SIZE_OPTIONS = ["solo", "2_5", "6_15", "16_plus"] as const;
const CLIENT_VOLUME_OPTIONS = [
  "under_25",
  "25_100",
  "100_300",
  "300_plus",
] as const;
const CURRENT_TOOL_OPTIONS = [
  "manual_email",
  "taxdome",
  "karbon",
  "other_software",
  "nothing",
] as const;

export function DemoFormFlow({ locale }: { locale: Locale }) {
  const t = useTranslations("Demo");
  const [view, setView] = useState<View>(1);
  const [rowId, setRowId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step1, setStep1] = useState<Step1State>({
    contact_name: "",
    email: "",
    firm_name: "",
  });
  const [step2, setStep2] = useState<Step2State>({
    firm_size: "",
    client_volume: "",
    current_tool: "",
    current_tool_other: "",
  });
  const [step3, setStep3] = useState<Step3State>({
    phone: "",
    province: "QC",
    preferred_language: locale,
    marketing_opt_in: false,
  });

  // Post-form views — the order is: form -> next-steps -> (booking)
  // -> booked. "next-steps" is the choice screen between trying the
  // seeded demo workspace and booking the founder.
  if (view === "booked") {
    return <BookedConfirmation firstName={firstName(step1.contact_name)} />;
  }
  if (view === "booking") {
    return (
      <DemoBookingStep
        demoId={rowId ?? ""}
        contactName={step1.contact_name}
        email={step1.email}
        locale={step3.preferred_language}
        onBack={() => setView("next-steps")}
        onBooked={() => setView("booked")}
      />
    );
  }
  if (view === "next-steps") {
    return (
      <NextSteps
        firstName={firstName(step1.contact_name)}
        onBookMeeting={() => setView("booking")}
      />
    );
  }

  const stepNumber = view as 1 | 2 | 3;

  return (
    <div className="space-y-6">
      <Header />

      <ProgressIndicator current={stepNumber} total={3} />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{translateError(error, t)}</AlertDescription>
        </Alert>
      )}

      {stepNumber === 1 && (
        <Step1
          state={step1}
          setState={setStep1}
          submitting={submitting}
          onNext={async () => {
            setError(null);
            const parsed = DemoStep1Schema.safeParse(step1);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "invalid");
              return;
            }
            setSubmitting(true);
            const res = await saveDemoStep({ step: 1, data: parsed.data });
            setSubmitting(false);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setRowId(res.id);
            setView(2);
          }}
        />
      )}

      {stepNumber === 2 && (
        <Step2
          state={step2}
          setState={setStep2}
          submitting={submitting}
          onBack={() => {
            setError(null);
            setView(1);
          }}
          onNext={async () => {
            setError(null);
            const parsed = DemoStep2Schema.safeParse(step2);
            if (!parsed.success) {
              setError(
                parsed.error.issues[0]?.message ?? "invalid",
              );
              return;
            }
            if (!rowId) {
              setError("missing_id");
              return;
            }
            setSubmitting(true);
            const res = await saveDemoStep({
              step: 2,
              data: parsed.data,
              existingId: rowId,
            });
            setSubmitting(false);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setView(3);
          }}
        />
      )}

      {stepNumber === 3 && (
        <Step3
          state={step3}
          setState={setStep3}
          submitting={submitting}
          onBack={() => {
            setError(null);
            setView(2);
          }}
          onSubmit={async () => {
            setError(null);
            const parsed = DemoStep3Schema.safeParse(step3);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "invalid");
              return;
            }
            if (!rowId) {
              setError("missing_id");
              return;
            }
            setSubmitting(true);
            const res = await saveDemoStep({
              step: 3,
              data: parsed.data,
              existingId: rowId,
            });
            setSubmitting(false);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setView("next-steps");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + progress
// ---------------------------------------------------------------------------

function Header() {
  const t = useTranslations("Demo");
  return (
    <div className="space-y-3">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 backdrop-blur px-3 py-1 text-[11px] font-medium">
        <Sparkles className="size-3 text-accent" aria-hidden />
        <span className="text-foreground">Vylan</span>
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">
        {t("page_title")}
      </h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t("page_subtitle")}
      </p>
    </div>
  );
}

function ProgressIndicator({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const t = useTranslations("Demo");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
          {t("step_indicator", { current, total })}
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < current ? "bg-accent" : "bg-border/60"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — who you are
// ---------------------------------------------------------------------------

function Step1({
  state,
  setState,
  submitting,
  onNext,
}: {
  state: Step1State;
  setState: (s: Step1State) => void;
  submitting: boolean;
  onNext: () => void | Promise<void>;
}) {
  const t = useTranslations("Demo");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) void onNext();
      }}
      className="space-y-5"
    >
      <h2 className="text-lg font-semibold">{t("step1_heading")}</h2>
      <Field
        id="contact_name"
        label={t("step1_name_label")}
        value={state.contact_name}
        onChange={(v) => setState({ ...state, contact_name: v })}
        placeholder={t("step1_name_placeholder")}
        autoComplete="name"
        required
      />
      <Field
        id="email"
        type="email"
        label={t("step1_email_label")}
        value={state.email}
        onChange={(v) => setState({ ...state, email: v })}
        placeholder={t("step1_email_placeholder")}
        autoComplete="email"
        inputMode="email"
        required
      />
      <Field
        id="firm_name"
        label={t("step1_firm_label")}
        value={state.firm_name}
        onChange={(v) => setState({ ...state, firm_name: v })}
        placeholder={t("step1_firm_placeholder")}
        autoComplete="organization"
        required
      />
      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="w-full sm:w-auto"
        >
          {submitting ? t("saving") : t("submit_step1")}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — qualifying
// ---------------------------------------------------------------------------

function Step2({
  state,
  setState,
  submitting,
  onBack,
  onNext,
}: {
  state: Step2State;
  setState: (s: Step2State) => void;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void | Promise<void>;
}) {
  const t = useTranslations("Demo");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) void onNext();
      }}
      className="space-y-5"
    >
      <h2 className="text-lg font-semibold">{t("step2_heading")}</h2>

      <SelectField
        id="firm_size"
        label={t("step2_size_label")}
        value={state.firm_size}
        onChange={(v) =>
          setState({ ...state, firm_size: v as Step2State["firm_size"] })
        }
        options={FIRM_SIZE_OPTIONS.map((o) => ({
          value: o,
          label: t(`step2_size_${o}` as const),
        }))}
      />

      <SelectField
        id="client_volume"
        label={t("step2_volume_label")}
        value={state.client_volume}
        onChange={(v) =>
          setState({
            ...state,
            client_volume: v as Step2State["client_volume"],
          })
        }
        options={CLIENT_VOLUME_OPTIONS.map((o) => ({
          value: o,
          label: t(`step2_volume_${o}` as const),
        }))}
      />

      <SelectField
        id="current_tool"
        label={t("step2_tool_label")}
        value={state.current_tool}
        onChange={(v) =>
          setState({
            ...state,
            current_tool: v as Step2State["current_tool"],
          })
        }
        options={CURRENT_TOOL_OPTIONS.map((o) => ({
          value: o,
          label: t(`step2_tool_${o}` as const),
        }))}
      />

      {state.current_tool === "other_software" && (
        <Field
          id="current_tool_other"
          label={t("step2_tool_other_label")}
          value={state.current_tool_other}
          onChange={(v) => setState({ ...state, current_tool_other: v })}
          placeholder={t("step2_tool_other_placeholder")}
          required
        />
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={submitting}
          size="lg"
          className="w-full sm:w-auto"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="w-full sm:w-auto"
        >
          {submitting ? t("saving") : t("submit_step2")}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — contact + scheduling
// ---------------------------------------------------------------------------

function Step3({
  state,
  setState,
  submitting,
  onBack,
  onSubmit,
}: {
  state: Step3State;
  setState: (s: Step3State) => void;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const t = useTranslations("Demo");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) void onSubmit();
      }}
      className="space-y-5"
    >
      <h2 className="text-lg font-semibold">{t("step3_heading")}</h2>

      <Field
        id="phone"
        type="tel"
        label={t("step3_phone_label")}
        value={state.phone}
        onChange={(v) => setState({ ...state, phone: v })}
        placeholder={t("step3_phone_placeholder")}
        autoComplete="tel"
        inputMode="tel"
      />

      <SelectField
        id="province"
        label={t("step3_province_label")}
        value={state.province}
        onChange={(v) => setState({ ...state, province: v as Province })}
        options={PROVINCES.map((p) => ({
          value: p,
          label: t(`province_${p}` as const),
        }))}
      />

      <SelectField
        id="preferred_language"
        label={t("step3_language_label")}
        value={state.preferred_language}
        onChange={(v) =>
          setState({
            ...state,
            preferred_language: v as Locale,
          })
        }
        options={[
          { value: "fr", label: t("step3_language_fr") },
          { value: "en", label: t("step3_language_en") },
        ]}
      />

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={state.marketing_opt_in}
          onChange={(e) =>
            setState({ ...state, marketing_opt_in: e.target.checked })
          }
          className="mt-1 size-4 rounded border-input text-accent focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-sm leading-snug">
          {t("step3_marketing_label")}
          <span className="block text-xs text-muted-foreground mt-1">
            {t.rich("step3_marketing_hint", {
              privacyLink: (chunks) => (
                <Link
                  href="/privacy"
                  className="underline text-foreground"
                  target="_blank"
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </span>
      </label>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={submitting}
          size="lg"
          className="w-full sm:w-auto"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="w-full sm:w-auto"
        >
          {submitting ? t("saving") : t("submit_step3")}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Choice screen — shown right after Step 3. Two paths:
//   1. Try the demo (primary) → /signup, which creates a demo-mode
//      firm with seeded clients + engagements (the existing flow).
//   2. Book a meeting (secondary) → cal.com inline embed.
//
// Either path is fine — the qualifying data + founder emails have
// already gone out by the time the prospect sees this screen.
// ---------------------------------------------------------------------------

function NextSteps({
  firstName: name,
  onBookMeeting,
}: {
  firstName: string;
  onBookMeeting: () => void;
}) {
  const t = useTranslations("Demo");
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto inline-flex items-center justify-center size-12 rounded-2xl bg-success/15 text-success">
          <Check className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">
          {t("next_heading", { name: name || "👋" })}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          {t("next_body")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-1">
        {/* Primary: jump into the seeded demo workspace. This is what
            we recommend so the prospect can poke around and form an
            opinion before the sales call.
            ?continue=onboarding tells signupAction to skip the
            funnel-discipline redirect back to /demo — the user has
            already qualified, no point looping them. */}
        <Link
          href="/signup?continue=onboarding"
          className="group rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] to-accent/[0.02] p-5 transition-colors hover:border-accent/60 hover:from-accent/[0.12]"
        >
          <div className="flex items-start gap-4">
            <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-xl bg-accent/15 text-accent">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold">
                  {t("next_demo_heading")}
                </h2>
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold rounded-full bg-accent/15 text-accent px-2 py-0.5">
                  {t("next_recommended")}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {t("next_demo_body")}
              </p>
              <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-foreground group-hover:gap-2 transition-all">
                {t("next_demo_cta")}
                <ArrowRight className="size-4" aria-hidden />
              </div>
            </div>
          </div>
        </Link>

        {/* Secondary: skip straight to a meeting. Useful for buyers
            who already know they want to talk. */}
        <button
          type="button"
          onClick={onBookMeeting}
          className="group text-left rounded-2xl border border-border/60 bg-card p-5 transition-colors hover:border-border hover:bg-secondary/30"
        >
          <div className="flex items-start gap-4">
            <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-xl bg-secondary/70 text-muted-foreground">
              <Calendar className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t("next_meeting_heading")}</h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {t("next_meeting_body")}
              </p>
              <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground group-hover:text-foreground group-hover:gap-2 transition-all">
                {t("next_meeting_cta")}
                <ArrowRight className="size-4" aria-hidden />
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation (Phase 4 sets it; shown after cal.com booking completes)
// ---------------------------------------------------------------------------

function BookedConfirmation({ firstName: name }: { firstName: string }) {
  const t = useTranslations("Demo");
  const headline = useMemo(
    () => (name ? `${t("booked_heading")} 🎉` : t("booked_heading")),
    [name, t],
  );
  return (
    <div className="space-y-6 text-center py-6">
      <div className="mx-auto inline-flex items-center justify-center size-14 rounded-2xl bg-success/15 text-success">
        <Check className="size-7" aria-hidden />
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        {headline}
      </h1>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
        {t("booked_body")}
      </p>
      <div className="rounded-2xl border border-border/60 bg-card/60 p-5 max-w-md mx-auto space-y-3 text-left">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-accent" aria-hidden />
          {t("booked_try_demo_heading")}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("booked_try_demo_body")}
        </p>
        <Link href="/signup" className="block">
          <Button size="lg" className="w-full">
            {t("booked_try_demo_cta")}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </Link>
      </div>
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
          {t("booked_back_home")}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

function Field({
  id,
  type = "text",
  label,
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  inputMode,
}: {
  id: string;
  type?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?:
    | "search"
    | "text"
    | "email"
    | "tel"
    | "url"
    | "none"
    | "numeric"
    | "decimal";
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
      />
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder ?? ""} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function firstName(label: string): string {
  return label.split(/\s+/)[0] ?? "";
}

function translateError(
  code: string,
  t: ReturnType<typeof useTranslations<"Demo">>,
): string {
  const key = `errors.${code}` as const;
  if (t.has(key)) return t(key);
  return t("errors.generic");
}
