"use client";

// The ⋯ beside a list's primary button. ONE component for engagements, tasks and
// anything added next.
//
// ── WHAT WAS ALREADY IN HERE, AND WHY ─────────────────────────────────────
//
// The founder asked why this menu holds three view links: "WHY is the 3 dots
// top right hiding those three button options shouldnt there be other things."
// Fair question, and the answer is their own earlier instruction: "delete that
// whole top line... The only top tab things should be: Active, Drafts, All
// engagements." Four views came off that strip and three had nowhere else to
// go — Ready to review, Archived, and Recently deleted, which is a 30-DAY
// RECOVERY WINDOW with a purge cron on the other side of it. Unreachable there
// would have meant unrecoverable.
//
// So this menu is an OVERFLOW OF VIEWS, not an actions menu — which is exactly
// why saved views belong in it too, and why tasks (which has no overflow views)
// still needs one now that there is something else to put inside.
//
// ── SAVED VIEWS ───────────────────────────────────────────────────────────
//
// "There should be an option to create/edit your own based off the filters
// below the dividers... But make it subtle and hide it in the 3 dots." So the
// MANAGING lives here; the views themselves become tabs, which is where Canopy
// puts them ("Active Clients | New Clients 2022 | Prospect | ... | Ben's
// Clients" — everything after the built-ins is somebody's saved filter).

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { BookmarkPlus, Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createSavedViewAction,
  deleteSavedViewAction,
  renameSavedViewAction,
  resaveSavedViewAction,
} from "@/app/actions/saved-views";
import { SAVED_VIEW_NAME_MAX } from "@/lib/views/saved-view";

export type ListSavedView = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
};

export function ListViewsMenu({
  label,
  links = [],
  surface,
  savedViews,
  activeViewId,
  currentFilters,
  onApply,
  onChanged,
}: {
  /** Accessible name for the trigger — it has no visible text. */
  label: string;
  /** Overflow VIEWS that live at their own URL (engagements has three). */
  links?: { href: string; label: string; count?: number }[];
  surface: "engagements" | "tasks" | "clients";
  savedViews: ListSavedView[];
  /** Which saved view the list is showing, if any. */
  activeViewId?: string | null;
  /** The list's filter state RIGHT NOW — what "Save this view" captures. */
  currentFilters: () => Record<string, unknown>;
  onApply: (view: ListSavedView) => void;
  /** Re-read from the server after a create / rename / delete. */
  onChanged: () => void;
}) {
  const t = useTranslations("Views");
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  // Which dialog is open: naming a new view, or renaming an existing one.
  const [naming, setNaming] = useState<null | { id?: string; name: string }>(
    null,
  );

  const report = (res: { ok: boolean; error?: string }): boolean => {
    if (res.ok) return true;
    toast.error(
      res.error === "duplicate"
        ? t("error_duplicate")
        : res.error === "too_many"
          ? t("error_too_many")
          : res.error === "bad_name"
            ? t("error_bad_name")
            : res.error === "not_ready"
              ? t("error_not_ready")
              : t("error_failed"),
    );
    return false;
  };

  async function submitName() {
    const name = naming?.name.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = naming?.id
        ? await renameSavedViewAction({ id: naming.id, name })
        : await createSavedViewAction({
            surface,
            name,
            // Captured at SAVE time, not at open time — you may have changed a
            // filter while the dialog was up.
            filters: currentFilters(),
          });
      if (report(res)) {
        setNaming(null);
        start(onChanged);
      }
    } finally {
      setBusy(false);
    }
  }

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true);
    try {
      if (report(await fn())) start(onChanged);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          {/* The overflow views, unchanged — they are the reason this menu
              existed at all and every one of them is somebody's only way in. */}
          {links.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} className="flex items-center gap-2">
                <span className="flex-1">{item.label}</span>
                {typeof item.count === "number" && item.count > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {item.count}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          ))}

          {links.length > 0 && <DropdownMenuSeparator />}

          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t("saved_heading")}
          </DropdownMenuLabel>

          {savedViews.length === 0 && (
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">
              {t("saved_empty")}
            </p>
          )}

          {savedViews.map((v) => (
            <DropdownMenuItem
              key={v.id}
              onSelect={() => onApply(v)}
              className="group/view gap-2"
            >
              <Check
                className={
                  activeViewId === v.id
                    ? "size-3.5 shrink-0 text-muted-foreground"
                    : "size-3.5 shrink-0 opacity-0"
                }
                aria-hidden
              />
              <span className="flex-1 truncate">{v.name}</span>
              {/* Edit and delete live ON the row rather than in a submenu:
                  managing a handful of tabs should not be a second journey. */}
              <span
                role="button"
                tabIndex={0}
                aria-label={t("rename_one", { name: v.name })}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setNaming({ id: v.id, name: v.name });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setNaming({ id: v.id, name: v.name });
                  }
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/view:opacity-100"
              >
                <Pencil className="size-3" aria-hidden />
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={t("delete_one", { name: v.name })}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void run(() => deleteSavedViewAction({ id: v.id }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    void run(() => deleteSavedViewAction({ id: v.id }));
                  }
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover/view:opacity-100"
              >
                <Trash2 className="size-3" aria-hidden />
              </span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setNaming({ name: "" })}>
            <BookmarkPlus className="size-4" aria-hidden />
            {t("save_current")}
          </DropdownMenuItem>

          {/* Only offered while you are ON a saved view — "update this one to
              what I am looking at now" is meaningless otherwise, and an item
              that does nothing is worse than a shorter menu. */}
          {activeViewId && (
            <DropdownMenuItem
              onSelect={() =>
                void run(() =>
                  resaveSavedViewAction({
                    id: activeViewId,
                    filters: currentFilters(),
                  }),
                )
              }
            >
              <Check className="size-4" aria-hidden />
              {t("resave")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={naming !== null}
        onOpenChange={(open) => !open && setNaming(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {naming?.id ? t("rename_title") : t("save_title")}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={naming?.name ?? ""}
            maxLength={SAVED_VIEW_NAME_MAX}
            placeholder={t("name_placeholder")}
            aria-label={t("name_label")}
            onChange={(e) =>
              setNaming((n) => (n ? { ...n, name: e.target.value } : n))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitName();
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => void submitName()}
              disabled={!naming?.name.trim() || busy}
            >
              {naming?.id ? t("rename_confirm") : t("save_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
