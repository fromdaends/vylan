"use client";

import { useState, useTransition } from "react";
import { submitFirmLead } from "@/app/actions/demo-request";
import type {
  PracticeType,
  ActiveClientBucket,
} from "@/app/actions/demo-request.schema";

export type LeadFormStrings = {
  title: string;
  sub: string;
  emailPlaceholder: string;
  firmPlaceholder: string;
  practiceLabel: string;
  practiceOptions: { value: PracticeType; label: string }[];
  clientsLabel: string;
  clientsOptions: { value: ActiveClientBucket; label: string }[];
  notesPlaceholder: string;
  submit: string;
  submitting: string;
  doneTitle: string;
  doneBody: string;
  errorGeneric: string;
  errorRate: string;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LeadForm({ s }: { s: LeadFormStrings }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const firm_name = String(data.get("firm") ?? "").trim();
    const practice_type = String(data.get("type") ?? "");
    const active_clients = String(data.get("clients") ?? "");
    const notes = String(data.get("notes") ?? "").trim();

    // Mirror the prototype's client-side email gate before hitting the
    // server (the server re-validates everything regardless).
    if (!EMAIL_RE.test(email)) {
      setEmailInvalid(true);
      const el = form.elements.namedItem("email");
      if (el instanceof HTMLElement) el.focus();
      return;
    }
    setEmailInvalid(false);

    startTransition(async () => {
      const res = await submitFirmLead({
        email,
        firm_name,
        practice_type,
        active_clients,
        notes,
      });
      if (res.ok) {
        setDone(true);
      } else {
        setError(res.error === "rate_limited" ? s.errorRate : s.errorGeneric);
      }
    });
  }

  return (
    <div className="vy-form-card">
      <div className="vy-glow" />
      <span className="vy-spark" aria-hidden>
        ✦
      </span>
      <h2>{s.title}</h2>
      <p className="vy-form-sub">{s.sub}</p>

      {done ? (
        <div className="vy-form-done">
          <b>{s.doneTitle}</b>
          <p>{s.doneBody}</p>
        </div>
      ) : (
        <form className="vy-fields" onSubmit={onSubmit} noValidate>
          <input
            className={"vy-field" + (emailInvalid ? " vy-invalid" : "")}
            type="email"
            name="email"
            placeholder={s.emailPlaceholder}
            autoComplete="email"
            required
            onChange={() => emailInvalid && setEmailInvalid(false)}
          />
          <input
            className="vy-field"
            type="text"
            name="firm"
            placeholder={s.firmPlaceholder}
            autoComplete="organization"
            required
          />
          <select className="vy-sel" name="type" required defaultValue="">
            <option value="" disabled>
              {s.practiceLabel}
            </option>
            {s.practiceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select className="vy-sel" name="clients" required defaultValue="">
            <option value="" disabled>
              {s.clientsLabel}
            </option>
            {s.clientsOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <textarea
            className="vy-field"
            name="notes"
            placeholder={s.notesPlaceholder}
            maxLength={2000}
          />
          {error && (
            <div className="vy-form-err" role="alert">
              {error}
            </div>
          )}
          <button className="vy-submit" type="submit" disabled={pending}>
            {pending ? s.submitting : s.submit}
          </button>
        </form>
      )}
    </div>
  );
}
