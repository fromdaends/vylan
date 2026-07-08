"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

// The editable transaction DATE on a QuickBooks draft (Stage 4). A correct date
// is required to post — it's what lets QuickBooks auto-match the transaction to
// the bank feed instead of dating it "today". Like the other draft cells, saving
// is optimistic (shows the pick immediately, reverts on failure) and goes to the
// stable resolve endpoint. When empty it's amber, mirroring the mapping cells.
export function QuickbooksDateField({
  fileId,
  initial,
  label,
  prompt,
  disabled = false,
}: {
  fileId: string;
  // The current effective date (accountant's override, else the AI's read), or
  // null when neither is set — YYYY-MM-DD.
  initial: string | null;
  // Accessible label (e.g. "Date").
  label: string;
  // Hint shown (as a tooltip) when no date is set yet.
  prompt: string;
  // Locked (approved / dismissed draft): read-only. Reopen to edit.
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(initial);
  const [pending, setPending] = useState(false);

  async function save(next: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    const prev = value;
    setValue(next); // optimistic
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: next }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
      else setValue(prev); // revert
    } catch {
      setValue(prev);
    } finally {
      setPending(false);
    }
  }

  const empty = value == null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
        disabled
          ? "text-muted-foreground"
          : empty
            ? "bg-warning/10 text-warning"
            : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      {pending ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : empty && !disabled ? (
        <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <CalendarDays className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      )}
      {disabled ? (
        <span className="font-medium">{empty ? "—" : value}</span>
      ) : (
        <input
          type="date"
          value={value ?? ""}
          disabled={pending}
          onChange={(e) => e.target.value && save(e.target.value)}
          aria-label={label}
          title={empty ? prompt : label}
          className="bg-transparent font-medium outline-none [color-scheme:light] disabled:opacity-60 dark:[color-scheme:dark]"
        />
      )}
    </span>
  );
}
