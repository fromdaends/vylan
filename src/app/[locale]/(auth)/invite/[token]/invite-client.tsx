"use client";

// Teammate-invite accept UI. Matches the /signup + /login design exactly:
// the blue glassmorphic .vy-* system on a fixed full-bleed layer over the
// (auth) layout, Schibsted Grotesk, white Vylan wordmark. Two views:
//   - InviteAcceptForm: the create-account card (the link is valid)
//   - InviteErrorView:  a calm full-card error (invalid / expired / used /
//                       cancelled link, or the firm is at its seat limit)

import "@/styles/vylan-landing.css";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  acceptInvite,
  switchFirmViaInvite,
  type AcceptInviteState,
  type SwitchFirmState,
} from "@/app/actions/team";
import { schibsted } from "@/components/vylan-landing/fonts";
import { brand } from "@/lib/brand";
import { ArrowRight, ShieldAlert } from "lucide-react";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className={`vy-root ${schibsted.variable}`}>
        <div className="mx-auto max-w-md px-6 pb-16 pt-9">
          {/* Brand */}
          <div className="mb-7 flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[22px] font-semibold tracking-[-0.04em] text-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/vylan-logo-white.png"
                alt={brand.name}
                className="h-6 w-6"
              />
              {brand.name}
            </Link>
          </div>

          {/* Card */}
          <div className="vy-form-card" style={{ width: "100%" }}>
            <div className="vy-glow" />
            <span className="vy-spark" aria-hidden>
              ✦
            </span>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InviteAcceptForm({
  firmName,
  inviterName,
  locale,
  token,
}: {
  firmName: string;
  inviterName: string;
  locale: "fr" | "en";
  token: string;
}) {
  const t = useTranslations("InviteAccept");
  const tc = useTranslations("Common");
  const [state, formAction, pending] = useActionState<
    AcceptInviteState,
    FormData
  >(acceptInvite, null);

  return (
    <Shell>
      <h2>{t("join_title", { firm: firmName })}</h2>
      <p className="vy-form-sub">
        {inviterName
          ? t("invited_by", { inviter: inviterName, firm: firmName })
          : t("invited_by_generic", { firm: firmName })}
      </p>

      <div className="vy-fields">
        {state?.error && (
          <div className="vy-form-err" role="alert">
            {t(`errors.${state.error}` as const)}
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-3.5">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="locale" value={locale} />

          <div>
            <input
              className={
                "vy-field" + (state?.fieldErrors?.name ? " vy-invalid" : "")
              }
              name="name"
              type="text"
              autoComplete="name"
              placeholder={t("name_label")}
              aria-label={t("name_label")}
              required
            />
            {state?.fieldErrors?.name && (
              <p className="mt-1.5 text-xs text-white/90">
                {t(`errors.${state.fieldErrors.name}` as const)}
              </p>
            )}
          </div>

          <div>
            <input
              className={
                "vy-field" + (state?.fieldErrors?.password ? " vy-invalid" : "")
              }
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={t("password_label")}
              aria-label={t("password_label")}
              minLength={8}
              required
            />
            {state?.fieldErrors?.password && (
              <p className="mt-1.5 text-xs text-white/90">
                {t(`errors.${state.fieldErrors.password}` as const)}
              </p>
            )}
          </div>

          <div>
            <input
              className={
                "vy-field" + (state?.fieldErrors?.confirm ? " vy-invalid" : "")
              }
              name="confirm"
              type="password"
              autoComplete="new-password"
              placeholder={t("confirm_label")}
              aria-label={t("confirm_label")}
              minLength={8}
              required
            />
            {state?.fieldErrors?.confirm && (
              <p className="mt-1.5 text-xs text-white/90">
                {t(`errors.${state.fieldErrors.confirm}` as const)}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending}
            className="vy-submit mt-1 inline-flex w-full items-center justify-center gap-2"
          >
            {pending ? tc("loading") : t("submit")}
            {!pending && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-white/55">
        {t("footer", { firm: firmName })}
      </p>
    </Shell>
  );
}

// Existing-account "switch over" card: the invited email already has a Vylan
// account, so instead of creating one we verify their password and MOVE their
// account into this firm. Shown with a clear warning that they'll leave their
// current firm (and lose access to its data) — the single-firm model.
export function InviteSwitchForm({
  firmName,
  inviterName,
  inviteEmail,
  currentFirmName,
  locale,
  token,
}: {
  firmName: string;
  inviterName: string;
  inviteEmail: string;
  currentFirmName: string;
  locale: "fr" | "en";
  token: string;
}) {
  const t = useTranslations("InviteAccept");
  const tc = useTranslations("Common");
  const [state, formAction, pending] = useActionState<
    SwitchFirmState,
    FormData
  >(switchFirmViaInvite, null);

  return (
    <Shell>
      <h2>{t("switch_title", { firm: firmName })}</h2>
      <p className="vy-form-sub">
        {inviterName
          ? t("invited_by", { inviter: inviterName, firm: firmName })
          : t("invited_by_generic", { firm: firmName })}
      </p>

      <div className="vy-fields">
        {state?.error && (
          <div className="vy-form-err" role="alert">
            {t(`errors.${state.error}` as const)}
          </div>
        )}

        <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm leading-relaxed text-white/85">
          {t("switch_warning", {
            email: inviteEmail,
            old: currentFirmName || t("your_firm"),
            firm: firmName,
          })}
        </div>

        <form action={formAction} className="mt-3.5 flex flex-col gap-3.5">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="locale" value={locale} />

          <input
            className={
              "vy-field" + (state?.error === "bad_password" ? " vy-invalid" : "")
            }
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder={t("password_current_label")}
            aria-label={t("password_current_label")}
            required
          />

          <button
            type="submit"
            disabled={pending}
            className="vy-submit mt-1 inline-flex w-full items-center justify-center gap-2"
          >
            {pending ? tc("loading") : t("switch_submit", { firm: firmName })}
            {!pending && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-white/55">
        {t("switch_footer")}
      </p>
    </Shell>
  );
}

export function InviteErrorView({
  reason,
  firmName,
  inviterName,
}: {
  reason:
    | "not_found"
    | "expired"
    | "accepted"
    | "revoked"
    | "seat_full"
    | "already_member"
    | "owns_team";
  firmName: string;
  inviterName: string;
}) {
  const t = useTranslations("InviteAccept");
  return (
    <Shell>
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white">
          <ShieldAlert className="h-7 w-7" aria-hidden />
        </div>
        <h2>{t("error_heading")}</h2>
        <p className="vy-form-sub">
          {t(`edge.${reason}` as const, {
            firm: firmName || t("your_firm"),
            inviter: inviterName || t("the_owner"),
          })}
        </p>
        <p className="mt-6 text-center text-sm text-white/75">
          <Link
            href="/login"
            className="font-semibold text-white underline-offset-4 hover:underline"
          >
            {t("back_to_sign_in")}
          </Link>
        </p>
      </div>
    </Shell>
  );
}
