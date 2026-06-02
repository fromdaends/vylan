"use client";

// The landing "Tell us about your firm" form IS the existing 3-phase
// demo-lead flow, restyled for the blue marketing page:
//   Phase 1 — name / email / firm           (saveDemoStep step 1)
//   Phase 2 — firm size / # clients / tool   (saveDemoStep step 2)
//   Phase 3 — phone / province / language /  (saveDemoStep step 3 →
//             marketing opt-in                 founder gets the lead email)
// Progressive save means a partial fill still captures the email. It
// reuses saveDemoStep + the Zod schemas + the "Demo" translations, so
// it writes only columns that already exist (no migration needed) and
// lands in the same demo_requests pipeline the /demo page uses.

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { saveDemoStep } from "@/app/actions/demo-request";
import {
  DemoStep1Schema,
  DemoStep2Schema,
  DemoStep3Schema,
  PROVINCES,
  type Province,
} from "@/app/actions/demo-request.schema";

type View = 1 | 2 | 3 | "done";
type Locale = "fr" | "en";

const FIRM_SIZES = ["solo", "2_5", "6_15", "16_plus"] as const;
const CLIENT_VOLUMES = ["under_25", "25_100", "100_300", "300_plus"] as const;
const TOOLS = [
  "manual_email",
  "taxdome",
  "karbon",
  "other_software",
  "nothing",
] as const;

export function LeadForm() {
  const t = useTranslations("Vylan");
  const td = useTranslations("Demo");
  const locale = useLocale();

  const [view, setView] = useState<View>(1);
  const [rowId, setRowId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [s1, setS1] = useState({ contact_name: "", email: "", firm_name: "" });
  const [s2, setS2] = useState({
    firm_size: "",
    client_volume: "",
    current_tool: "",
    current_tool_other: "",
  });
  const [s3, setS3] = useState({
    phone: "",
    province: "QC" as Province,
    preferred_language: (locale === "fr" ? "fr" : "en") as Locale,
    marketing_opt_in: false,
  });

  function showError(code: string) {
    const key = `errors.${code}` as const;
    setError(td.has(key) ? td(key) : td("errors.generic"));
  }

  async function submitStep1(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = DemoStep1Schema.safeParse(s1);
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? "invalid");
      return;
    }
    setSubmitting(true);
    const res = await saveDemoStep({ step: 1, data: parsed.data });
    setSubmitting(false);
    if (!res.ok) return showError(res.error);
    setRowId(res.id);
    setView(2);
  }

  async function submitStep2(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = DemoStep2Schema.safeParse(s2);
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? "invalid");
      return;
    }
    if (!rowId) return showError("missing_id");
    setSubmitting(true);
    const res = await saveDemoStep({
      step: 2,
      data: parsed.data,
      existingId: rowId,
    });
    setSubmitting(false);
    if (!res.ok) return showError(res.error);
    setView(3);
  }

  async function submitStep3(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = DemoStep3Schema.safeParse(s3);
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? "invalid");
      return;
    }
    if (!rowId) return showError("missing_id");
    setSubmitting(true);
    const res = await saveDemoStep({
      step: 3,
      data: parsed.data,
      existingId: rowId,
    });
    setSubmitting(false);
    if (!res.ok) return showError(res.error);
    setView("done");
  }

  return (
    <div className="vy-form-card">
      <div className="vy-glow" />
      <span className="vy-spark" aria-hidden>
        ✦
      </span>
      <h2>{t("form_title")}</h2>

      {view === "done" ? (
        <div className="vy-form-done">
          <b>{t("form_done_title")}</b>
          <p>{t("form_done_body")}</p>
        </div>
      ) : (
        <>
          {view === 1 && <p className="vy-form-sub">{t("form_sub")}</p>}

          {/* 3-step progress */}
          <div className="vy-steps" aria-hidden>
            {[1, 2, 3].map((n) => (
              <span key={n} className={"vy-step" + (n <= view ? " vy-on" : "")} />
            ))}
          </div>

          {error && (
            <div className="vy-form-err" role="alert">
              {error}
            </div>
          )}

          {view === 1 && (
            <form className="vy-fields" onSubmit={submitStep1} noValidate>
              <input
                className="vy-field"
                type="text"
                value={s1.contact_name}
                onChange={(e) => setS1({ ...s1, contact_name: e.target.value })}
                placeholder={td("step1_name_label")}
                autoComplete="name"
                required
              />
              <input
                className="vy-field"
                type="email"
                value={s1.email}
                onChange={(e) => setS1({ ...s1, email: e.target.value })}
                placeholder={td("step1_email_label")}
                autoComplete="email"
                inputMode="email"
                required
              />
              <input
                className="vy-field"
                type="text"
                value={s1.firm_name}
                onChange={(e) => setS1({ ...s1, firm_name: e.target.value })}
                placeholder={td("step1_firm_label")}
                autoComplete="organization"
                required
              />
              <div className="vy-btn-row">
                <span />
                <button className="vy-submit" type="submit" disabled={submitting}>
                  {submitting ? t("form_submitting") : td("submit_step1")}
                </button>
              </div>
            </form>
          )}

          {view === 2 && (
            <form className="vy-fields" onSubmit={submitStep2} noValidate>
              <Sel
                value={s2.firm_size}
                onChange={(v) => setS2({ ...s2, firm_size: v })}
                placeholder={td("step2_size_label")}
                options={FIRM_SIZES.map((o) => ({
                  value: o,
                  label: td(`step2_size_${o}`),
                }))}
              />
              <Sel
                value={s2.client_volume}
                onChange={(v) => setS2({ ...s2, client_volume: v })}
                placeholder={td("step2_volume_label")}
                options={CLIENT_VOLUMES.map((o) => ({
                  value: o,
                  label: td(`step2_volume_${o}`),
                }))}
              />
              <Sel
                value={s2.current_tool}
                onChange={(v) => setS2({ ...s2, current_tool: v })}
                placeholder={td("step2_tool_label")}
                options={TOOLS.map((o) => ({
                  value: o,
                  label: td(`step2_tool_${o}`),
                }))}
              />
              {s2.current_tool === "other_software" && (
                <input
                  className="vy-field"
                  type="text"
                  value={s2.current_tool_other}
                  onChange={(e) =>
                    setS2({ ...s2, current_tool_other: e.target.value })
                  }
                  placeholder={td("step2_tool_other_placeholder")}
                  required
                />
              )}
              <div className="vy-btn-row">
                <button
                  className="vy-back-btn"
                  type="button"
                  onClick={() => {
                    setError(null);
                    setView(1);
                  }}
                  disabled={submitting}
                >
                  ← {td("back")}
                </button>
                <button className="vy-submit" type="submit" disabled={submitting}>
                  {submitting ? t("form_submitting") : td("submit_step2")}
                </button>
              </div>
            </form>
          )}

          {view === 3 && (
            <form className="vy-fields" onSubmit={submitStep3} noValidate>
              <input
                className="vy-field"
                type="tel"
                value={s3.phone}
                onChange={(e) => setS3({ ...s3, phone: e.target.value })}
                placeholder={td("step3_phone_label")}
                autoComplete="tel"
                inputMode="tel"
              />
              <Sel
                value={s3.province}
                onChange={(v) => setS3({ ...s3, province: v as Province })}
                placeholder={td("step3_province_label")}
                options={PROVINCES.map((p) => ({
                  value: p,
                  label: td(`province_${p}`),
                }))}
              />
              <Sel
                value={s3.preferred_language}
                onChange={(v) => setS3({ ...s3, preferred_language: v as Locale })}
                placeholder={td("step3_language_label")}
                options={[
                  { value: "fr", label: td("step3_language_fr") },
                  { value: "en", label: td("step3_language_en") },
                ]}
              />
              <label className="vy-check-row">
                <input
                  type="checkbox"
                  checked={s3.marketing_opt_in}
                  onChange={(e) =>
                    setS3({ ...s3, marketing_opt_in: e.target.checked })
                  }
                />
                <span>
                  {td("step3_marketing_label")}
                  <span className="vy-check-hint">
                    {td.rich("step3_marketing_hint", {
                      privacyLink: (chunks) => (
                        <Link href="/privacy" target="_blank">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </span>
                </span>
              </label>
              <div className="vy-btn-row">
                <button
                  className="vy-back-btn"
                  type="button"
                  onClick={() => {
                    setError(null);
                    setView(2);
                  }}
                  disabled={submitting}
                >
                  ← {td("back")}
                </button>
                <button className="vy-submit" type="submit" disabled={submitting}>
                  {submitting ? t("form_submitting") : t("form_submit")}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

// Native blue-styled select (matches the prototype's `.vy-sel`). A
// disabled empty option acts as the placeholder.
function Sel({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="vy-sel"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
