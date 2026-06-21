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
type SyncState = {
  lastSyncedAt: string | null;
  status: "idle" | "syncing" | "ok" | "error";
  error: string | null;
};
type ListsResponse = { lists?: Lists | null; syncState?: SyncState | null };
type Status = "loading" | "loaded" | "error";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Read-only QuickBooks reference lists shown under the connected card. Reads from
// Vylan's local cache (fast) via /lists; the "Refresh from QuickBooks" button
// enqueues a background sync (/sync) and then polls until the new copy lands.
// Shows "Last synced" + sync status. Any firm member.
export function QuickbooksLists() {
  const t = useTranslations("Settings");
  const format = useFormatter();
  const [status, setStatus] = useState<Status>("loading");
  const [lists, setLists] = useState<Lists | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [posting, setPosting] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const mountedRef = useRef(true);

  const fetchLists = useCallback(async (): Promise<ListsResponse | null> => {
    const res = await fetch("/api/integrations/quickbooks/lists");
    const data = (await res.json().catch(() => null)) as ListsResponse | null;
    return res.ok ? data : null;
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchLists();
      if (!mountedRef.current) return;
      if (data?.lists) {
        setLists(data.lists);
        setSyncState(data.syncState ?? null);
        setStatus("loaded");
      } else {
        setSyncState(data?.syncState ?? null);
        setStatus("error");
      }
    } catch {
      if (mountedRef.current) setStatus("error");
    }
  }, [fetchLists]);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function refresh() {
    setPosting(true);
    setRefreshError(false);
    setRefreshNonce((n) => n + 1);
    const prevSynced = syncState?.lastSyncedAt ?? null;
    let posted = false;
    try {
      const res = await fetch("/api/integrations/quickbooks/sync", {
        method: "POST",
      });
      posted = res.ok;
      if (!res.ok && mountedRef.current) setRefreshError(true);
    } catch {
      if (mountedRef.current) setRefreshError(true);
    }
    if (mountedRef.current) setPosting(false);
    if (!posted || !mountedRef.current) return;

    // Optimistic "syncing", then poll (every 12s, up to ~3 min) for the
    // background job to land a fresh copy.
    setSyncState((s) =>
      s
        ? { ...s, status: "syncing" }
        : { lastSyncedAt: prevSynced, status: "syncing", error: null },
    );
    for (let i = 0; i < 16; i++) {
      await delay(12_000);
      if (!mountedRef.current) return;
      const data = await fetchLists().catch(() => null);
      if (!mountedRef.current) return;
      const ns = data?.syncState ?? null;
      if (ns?.lastSyncedAt && ns.lastSyncedAt !== prevSynced) {
        if (data?.lists) setLists(data.lists);
        setSyncState(ns);
        setStatus("loaded");
        return;
      }
      if (ns?.status === "error") {
        setSyncState(ns);
        return;
      }
    }
    // Poll timed out — reconcile with the real server state so the "Syncing…"
    // indicator never outlives the poll.
    if (mountedRef.current) {
      const data = await fetchLists().catch(() => null);
      if (mountedRef.current && data?.syncState) {
        if (data.lists) setLists(data.lists);
        setSyncState(data.syncState);
      }
    }
  }

  const refreshBtn = (
    <RefreshButton
      onClick={refresh}
      busy={posting}
      label={t("qbo_refresh_cta")}
      busyLabel={t("qbo_refreshing")}
    />
  );

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
        {refreshBtn}
      </div>
    );
  }

  const syncing = syncState?.status === "syncing";

  return (
    <div className="mt-4 max-w-xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {syncing ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
              {t("qbo_syncing")}
            </>
          ) : syncState?.lastSyncedAt ? (
            t("qbo_last_synced", {
              time: format.relativeTime(new Date(syncState.lastSyncedAt)),
            })
          ) : null}
        </span>
        {refreshBtn}
      </div>
      {syncing && (
        <p className="mb-2 text-xs text-muted-foreground">
          {t("qbo_sync_pending")}
        </p>
      )}
      {!syncing && syncState?.status === "error" && (
        <p role="alert" className="mb-2 text-xs text-muted-foreground">
          {t("qbo_sync_error")}
        </p>
      )}
      {refreshError && (
        <p role="alert" className="mb-2 text-xs text-muted-foreground">
          {t("qbo_refresh_failed")}
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
  busy,
  label,
  busyLabel,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      <RefreshCw
        className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")}
        aria-hidden="true"
      />
      {busy ? busyLabel : label}
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
