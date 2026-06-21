"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { RefreshCw } from "lucide-react";

type Named = { id: string; name: string; active: boolean };
type Account = Named & { accountType: string | null };
type Lists = {
  accounts: Account[] | null;
  vendors: Named[] | null;
  customers: Named[] | null;
  taxCodes: Named[] | null;
};
type Status = "loading" | "loaded" | "error";

// Read-only QuickBooks reference lists (accounts, vendors, customers, tax codes)
// shown under the connected card. Fetches live from /api/.../lists on mount (so
// the Settings render never blocks on QuickBooks) and on an explicit Refresh.
// Shows the time it was last loaded. A failed refresh keeps the last good lists
// on screen with a small note. Any firm member.
export function QuickbooksLists() {
  const t = useTranslations("Settings");
  const format = useFormatter();
  const [status, setStatus] = useState<Status>("loading");
  const [lists, setLists] = useState<Lists | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  // Bumped on each refresh so the error-branch alert re-mounts and re-announces
  // if a retry from the error state also fails (otherwise nothing changes).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const mountedRef = useRef(true);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) {
      setRefreshing(true);
      setRefreshError(false);
      setRefreshNonce((n) => n + 1);
    }
    try {
      const res = await fetch("/api/integrations/quickbooks/lists");
      const data = (await res.json().catch(() => null)) as {
        lists?: Lists | null;
      } | null;
      if (!mountedRef.current) return;
      if (res.ok && data?.lists) {
        setLists(data.lists);
        setLastLoaded(new Date());
        setStatus("loaded");
      } else if (isRefresh) {
        // Keep the last good lists on screen; just flag the failed refresh.
        setRefreshError(true);
      } else {
        setStatus("error");
      }
    } catch {
      if (!mountedRef.current) return;
      if (isRefresh) setRefreshError(true);
      else setStatus("error");
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // load() only calls setState after an await (it's async), so this is not a
    // synchronous setState-in-effect — the rule is conservative about the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  if (status === "loading") {
    return (
      <p className="mt-4 max-w-xl text-xs text-muted-foreground">
        {t("qbo_lists_loading")}
      </p>
    );
  }
  if (status === "error" || !lists) {
    return (
      <div className="mt-4 max-w-xl space-y-2">
        <p
          key={refreshNonce}
          role="alert"
          className="text-xs text-muted-foreground"
        >
          {t("qbo_lists_error")}
        </p>
        <RefreshButton
          onClick={() => load(true)}
          refreshing={refreshing}
          label={t("qbo_refresh_cta")}
          busyLabel={t("qbo_refreshing")}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 max-w-xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {lastLoaded &&
            t("qbo_last_loaded", {
              time: format.dateTime(lastLoaded, {
                hour: "numeric",
                minute: "numeric",
              }),
            })}
        </span>
        <RefreshButton
          onClick={() => load(true)}
          refreshing={refreshing}
          label={t("qbo_refresh_cta")}
          busyLabel={t("qbo_refreshing")}
        />
      </div>
      {refreshError && (
        <p role="alert" className="mb-2 text-xs text-muted-foreground">
          {t("qbo_refresh_error")}
        </p>
      )}
      <div className="space-y-2">
        <ListSection label={t("qbo_accounts_title")} rows={lists.accounts} showType />
        <ListSection label={t("qbo_section_vendors")} rows={lists.vendors} />
        <ListSection label={t("qbo_section_customers")} rows={lists.customers} />
        <ListSection label={t("qbo_section_taxcodes")} rows={lists.taxCodes} />
      </div>
    </div>
  );
}

function RefreshButton({
  onClick,
  refreshing,
  label,
  busyLabel,
}: {
  onClick: () => void;
  refreshing: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      aria-busy={refreshing}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      <RefreshCw
        className={"h-3.5 w-3.5" + (refreshing ? " animate-spin" : "")}
        aria-hidden="true"
      />
      {refreshing ? busyLabel : label}
    </button>
  );
}

function ListSection({
  label,
  rows,
  showType,
}: {
  label: string;
  rows: (Named & { accountType?: string | null })[] | null;
  showType?: boolean;
}) {
  const t = useTranslations("Settings");
  return (
    <details className="rounded-lg border border-border/50">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {label}
        {rows !== null && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({rows.length})
          </span>
        )}
      </summary>
      <div className="border-t border-border/50 px-3 py-2">
        {rows === null ? (
          <p role="alert" className="text-xs text-muted-foreground">
            {t("qbo_section_error")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("qbo_section_empty")}</p>
        ) : (
          <ul className="max-h-56 divide-y divide-border/50 overflow-y-auto text-xs">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span
                  className={r.active ? "" : "text-muted-foreground line-through"}
                >
                  {r.name}
                </span>
                {showType && r.accountType && (
                  <span className="shrink-0 text-muted-foreground">
                    {r.accountType}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
