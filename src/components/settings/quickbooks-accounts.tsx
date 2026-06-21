"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Account = {
  id: string;
  name: string;
  accountType: string | null;
  active: boolean;
};
type Status = "loading" | "loaded" | "error";

// Read-only Chart of Accounts list shown under the connected QuickBooks card.
// Fetches live from /api/integrations/quickbooks/accounts on mount, so the
// Settings page render is never blocked on a QuickBooks call. Shows a calm note
// if the read hiccups rather than breaking the page. Visible to any firm member.
export function QuickbooksAccounts() {
  const t = useTranslations("Settings");
  const [status, setStatus] = useState<Status>("loading");
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/integrations/quickbooks/accounts");
        const data = (await res.json().catch(() => null)) as {
          accounts?: Account[] | null;
        } | null;
        if (cancelled) return;
        if (res.ok && data?.accounts) {
          setAccounts(data.accounts);
          setStatus("loaded");
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-4 max-w-xl">
      <h3 className="text-sm font-medium">{t("qbo_accounts_title")}</h3>
      {status === "loading" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("qbo_accounts_loading")}
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-1 text-xs text-muted-foreground">
          {t("qbo_accounts_error")}
        </p>
      )}
      {status === "loaded" &&
        (accounts.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("qbo_accounts_empty")}
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("qbo_accounts_count", { count: accounts.length })}
            </p>
            <ul className="mt-2 max-h-64 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/50">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <span
                    className={
                      a.active ? "" : "text-muted-foreground line-through"
                    }
                  >
                    {a.name}
                  </span>
                  {a.accountType && (
                    <span className="shrink-0 text-muted-foreground">
                      {a.accountType}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
