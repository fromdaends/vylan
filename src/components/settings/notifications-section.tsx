"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { BellOff, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SegmentedControl } from "@/components/performance/segmented-control";
import {
  eventsByCategory,
  descriptionKeyFor,
  labelKeyFor,
  type NotificationCategory,
} from "@/lib/notifications/catalog";
import {
  saveNotificationSettingsAction,
  unmuteEntityAction,
} from "@/app/actions/notifications";
import type {
  MuteRow,
  NotificationPreferenceRow,
} from "@/lib/db/notification-settings";
import type { RecipientSettings } from "@/lib/notifications/resolve";

// Categories open on first render. Documents and Engagements are the two a firm
// touches daily; the rest start collapsed so the page opens as a readable list
// of headings rather than a wall of forty switches.
const INITIALLY_OPEN: NotificationCategory[] = ["documents", "engagements"];

// Same list as CA_TIMEZONES in settings-form and the allow-list in the save
// action. Labels are Common.* keys so the zone descriptors translate
// (Eastern -> Est), matching how the firm timezone picker already reads.
const TIMEZONES: ReadonlyArray<readonly [string, string]> = [
  ["America/Toronto", "tz_eastern"],
  ["America/Halifax", "tz_atlantic"],
  ["America/St_Johns", "tz_newfoundland"],
  ["America/Winnipeg", "tz_central"],
  ["America/Edmonton", "tz_mountain"],
  ["America/Vancouver", "tz_pacific"],
];

type PrefMap = Record<string, { inApp: boolean; email: boolean }>;

// <input type="time"> yields "" while the user is mid-entry or has cleared it.
// Writing that into state strands an invalid value that the server rejects with
// a generic error — and because these controls are conditionally rendered, the
// offending field may not even be on screen. Ignore empties and keep the last
// good value; the control still shows what the user typed.
function timeOrKeep(next: string, current: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(next) ? next : current;
}

export function NotificationsSection({
  isOwner,
  initialSettings,
  initialPreferences,
  mutes,
  schemaReady,
  focusEventKey,
}: {
  isOwner: boolean;
  initialSettings: RecipientSettings;
  initialPreferences: NotificationPreferenceRow[];
  mutes: MuteRow[];
  schemaReady: boolean;
  // Set from ?event=<key> — the "turn off this type of email" link in every
  // notification email lands here with its row highlighted and its category
  // already open, so the user is not left hunting through collapsed sections.
  focusEventKey?: string | null;
}) {
  const t = useTranslations("Notifications");
  const tCommon = useTranslations("Common");
  const [pending, startTransition] = useTransition();

  const groups = useMemo(
    () => eventsByCategory(isOwner ? "owner" : "staff"),
    [isOwner],
  );

  // Baselines for dirty tracking. Preferences are stored sparsely (only what
  // differs from the catalog default), so the working map is the catalog
  // defaults with the user's saved rows layered on top.
  const baselinePrefs = useMemo<PrefMap>(() => {
    const map: PrefMap = {};
    for (const g of groups) {
      for (const e of g.events) {
        map[e.key] = { inApp: e.defaultInApp, email: e.defaultEmail };
      }
    }
    for (const row of initialPreferences) {
      if (map[row.event_key]) {
        map[row.event_key] = { inApp: row.in_app, email: row.email };
      }
    }
    return map;
  }, [groups, initialPreferences]);

  const [settings, setSettings] = useState<RecipientSettings>(initialSettings);
  const [prefs, setPrefs] = useState<PrefMap>(baselinePrefs);
  const [open, setOpen] = useState<Set<NotificationCategory>>(() => {
    const initial = new Set<NotificationCategory>(INITIALLY_OPEN);
    if (focusEventKey) {
      const g = groups.find((x) =>
        x.events.some((e) => e.key === focusEventKey),
      );
      if (g) initial.add(g.category);
    }
    return initial;
  });

  const dirty =
    JSON.stringify(settings) !== JSON.stringify(initialSettings) ||
    JSON.stringify(prefs) !== JSON.stringify(baselinePrefs);

  function patch(next: Partial<RecipientSettings>) {
    setSettings((s) => ({ ...s, ...next }));
  }

  function setPref(
    key: string,
    next: Partial<{ inApp: boolean; email: boolean }>,
  ) {
    setPrefs((p) => ({ ...p, [key]: { ...p[key], ...next } }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveNotificationSettingsAction({
        settings,
        preferences: Object.entries(prefs).map(([eventKey, v]) => ({
          eventKey,
          inApp: v.inApp,
          email: v.email,
        })),
      });
      if (res.ok) {
        toast.success(t("saved"));
      } else {
        toast.error(
          res.error === "schema_missing"
            ? t("schema_missing")
            : t("save_error"),
        );
      }
    });
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-12">
        <section>
          <h2 className="text-sm font-semibold">{t("settings_title")}</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            {t("settings_subtitle")}
          </p>
          {!schemaReady && (
            <p className="mt-3 max-w-xl rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
              {t("schema_missing")}
            </p>
          )}
        </section>

        {/* 1. Delivery */}
        <section className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">{t("delivery_title")}</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {t("delivery_hint")}
            </p>
          </div>

          <Row
            label={t("master_email_label")}
            hint={t("master_email_hint")}
            control={
              <Switch
                checked={settings.emailEnabled}
                onCheckedChange={(v) => patch({ emailEnabled: v })}
                aria-label={t("master_email_label")}
              />
            }
          />

          <div className="max-w-xl space-y-2">
            <Label className="text-xs font-medium">{t("mode_label")}</Label>
            <SegmentedControl
              ariaLabel={t("mode_label")}
              size="sm"
              disabled={!settings.emailEnabled}
              value={settings.emailMode}
              onChange={(v) => patch({ emailMode: v })}
              options={[
                { value: "instant", label: t("mode_instant") },
                { value: "hourly_digest", label: t("mode_hourly") },
                { value: "daily_digest", label: t("mode_daily") },
              ]}
            />
          </div>

          {settings.emailMode === "daily_digest" && (
            <div className="max-w-xs space-y-2">
              <Label htmlFor="digest-time" className="text-xs font-medium">
                {t("digest_time_label")}
              </Label>
              <Input
                id="digest-time"
                type="time"
                value={settings.dailyDigestTime.slice(0, 5)}
                onChange={(e) =>
                  patch({
                    dailyDigestTime: timeOrKeep(
                      e.target.value,
                      settings.dailyDigestTime,
                    ),
                  })
                }
                disabled={!settings.emailEnabled}
              />
            </div>
          )}

          <div className="max-w-xs space-y-2">
            <Label className="text-xs font-medium">{t("timezone_label")}</Label>
            <Select
              value={settings.timezone}
              onValueChange={(v) => patch({ timezone: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map(([tz, labelKey]) => (
                  <SelectItem key={tz} value={tz}>
                    {tCommon(labelKey as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("timezone_hint")}
            </p>
          </div>

          <div className="max-w-xl space-y-2">
            <Label className="text-xs font-medium">{t("detail_label")}</Label>
            <SegmentedControl
              ariaLabel={t("detail_label")}
              size="sm"
              disabled={!settings.emailEnabled}
              value={settings.emailDetailLevel}
              onChange={(v) => patch({ emailDetailLevel: v })}
              options={[
                { value: "full", label: t("detail_full") },
                { value: "minimal", label: t("detail_minimal") },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t("detail_hint")}</p>
          </div>
        </section>

        {/* 2. What you get notified about */}
        <section className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">{t("events_title")}</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {t("events_hint")}
            </p>
          </div>

          {/* The single most consequential control on the page, so it sits
              ABOVE the switch wall rather than inside it. */}
          <div className="max-w-xl space-y-2">
            <Label className="text-xs font-medium">{t("scope_label")}</Label>
            <SegmentedControl
              ariaLabel={t("scope_label")}
              size="sm"
              value={settings.scope}
              onChange={(v) => patch({ scope: v })}
              options={[
                { value: "all_firm", label: t("scope_all") },
                { value: "assigned_only", label: t("scope_assigned") },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {settings.scope === "all_firm"
                ? t("scope_all_hint")
                : t("scope_assigned_hint")}
            </p>
          </div>

          <div className="max-w-2xl divide-y divide-border/60 border-y border-border/60">
            {groups.map((group) => {
              const isOpen = open.has(group.category);
              return (
                <div key={group.category}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.category))
                          next.delete(group.category);
                        else next.add(group.category);
                        return next;
                      })
                    }
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <span className="text-sm font-medium">
                      {t(`cat_${group.category}` as never)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>

                  {isOpen && (
                    <div className="pb-3">
                      {/* Column headers stick to the top of each category block
                          so a long list never leaves you guessing which switch
                          is which. */}
                      <div className="sticky top-0 z-10 flex items-center justify-end gap-3 bg-background/95 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                        <span className="w-14 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t("col_in_app")}
                        </span>
                        <span className="w-14 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t("col_email")}
                        </span>
                      </div>

                      <ul className="space-y-1">
                        {group.events.map((event) => {
                          const value = prefs[event.key];
                          const locked = !event.canDisable;
                          const lockLabel =
                            event.category === "firm" &&
                            event.key.startsWith("billing.")
                              ? t("locked_billing")
                              : t("locked_security");
                          return (
                            <li
                              key={event.key}
                              className={cn(
                                "flex items-start gap-3 rounded-lg px-2 py-2 -mx-2",
                                focusEventKey === event.key &&
                                  "bg-primary/5 ring-1 ring-primary/25",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-sm">
                                  <span>
                                    {t(labelKeyFor(event.key) as never)}
                                  </span>
                                  {locked && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          tabIndex={0}
                                          className="inline-flex text-muted-foreground"
                                          aria-label={lockLabel}
                                        >
                                          <Lock
                                            className="h-3 w-3"
                                            aria-hidden
                                          />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {lockLabel}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {t(descriptionKeyFor(event.key) as never)}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 pt-0.5">
                                <div className="flex w-14 justify-end">
                                  <Switch
                                    checked={locked ? true : value.inApp}
                                    disabled={locked}
                                    onCheckedChange={(v) =>
                                      setPref(event.key, { inApp: v })
                                    }
                                    aria-label={`${t(labelKeyFor(event.key) as never)} — ${t("col_in_app")}`}
                                  />
                                </div>
                                <div className="flex w-14 justify-end">
                                  <Switch
                                    checked={locked ? true : value.email}
                                    disabled={locked || !settings.emailEnabled}
                                    onCheckedChange={(v) =>
                                      setPref(event.key, { email: v })
                                    }
                                    aria-label={`${t(labelKeyFor(event.key) as never)} — ${t("col_email")}`}
                                  />
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="max-w-xl text-xs text-muted-foreground">
            {t("automation_pointer")}{" "}
            <Link
              href="/settings?tab=automation"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("automation_link")}
            </Link>
          </p>
        </section>

        {/* 3. Quiet hours */}
        <section className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">{t("quiet_title")}</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {t("quiet_hint")}
            </p>
          </div>

          <Row
            label={t("quiet_enable")}
            control={
              <Switch
                checked={settings.quietHoursEnabled}
                onCheckedChange={(v) => patch({ quietHoursEnabled: v })}
                aria-label={t("quiet_enable")}
              />
            }
          />

          {settings.quietHoursEnabled && (
            <div className="flex max-w-xl flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="quiet-start" className="text-xs font-medium">
                  {t("quiet_start")}
                </Label>
                <Input
                  id="quiet-start"
                  type="time"
                  className="w-32"
                  value={settings.quietHoursStart.slice(0, 5)}
                  onChange={(e) =>
                    patch({
                      quietHoursStart: timeOrKeep(
                        e.target.value,
                        settings.quietHoursStart,
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet-end" className="text-xs font-medium">
                  {t("quiet_end")}
                </Label>
                <Input
                  id="quiet-end"
                  type="time"
                  className="w-32"
                  value={settings.quietHoursEnd.slice(0, 5)}
                  onChange={(e) =>
                    patch({
                      quietHoursEnd: timeOrKeep(
                        e.target.value,
                        settings.quietHoursEnd,
                      ),
                    })
                  }
                />
              </div>
            </div>
          )}

          <Row
            label={t("quiet_weekends")}
            control={
              <Switch
                checked={settings.pauseWeekends}
                onCheckedChange={(v) => patch({ pauseWeekends: v })}
                aria-label={t("quiet_weekends")}
              />
            }
          />
        </section>

        {/* 4. Muted */}
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">{t("muted_title")}</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {t("muted_hint")}
            </p>
          </div>
          <MutedList mutes={mutes} />
        </section>

        {/* Save — one button for the whole tab, dirty-gated, like the rest of
            Settings' section forms. */}
        <div className="flex items-center gap-3 border-t border-border/60 pt-6">
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? t("saving") : t("save")}
          </Button>
          {dirty && !pending && (
            <span className="text-xs text-muted-foreground">
              {t("unsaved_changes")}
            </span>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex max-w-xl items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

function MutedList({ mutes }: { mutes: MuteRow[] }) {
  const t = useTranslations("Notifications");
  const [pending, startTransition] = useTransition();
  // Optimistic removal: unmuting is instant and reversible, so waiting on a
  // round-trip to make the row disappear would feel broken.
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const visible = mutes.filter(
    (m) => !removed.has(`${m.entity_type}:${m.entity_id}`),
  );

  if (visible.length === 0) {
    return (
      <div className="flex max-w-xl flex-col items-start gap-1 rounded-lg border border-dashed border-border/60 px-4 py-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BellOff className="h-4 w-4" aria-hidden />
          {t("muted_empty")}
        </div>
        <p className="text-xs text-muted-foreground/80">
          {t("muted_empty_hint")}
        </p>
      </div>
    );
  }

  return (
    <ul className="max-w-xl divide-y divide-border/60 border-y border-border/60">
      {visible.map((m) => {
        const key = `${m.entity_type}:${m.entity_id}`;
        return (
          <li
            key={key}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm">
                {/* A mute whose target was deleted still gets a row, so the
                    user can always clear it rather than being stuck with an
                    invisible setting. */}
                {m.label ?? (
                  <span className="italic text-muted-foreground">
                    {t("muted_deleted")}
                  </span>
                )}
              </div>
              {m.sublabel && (
                <div className="truncate text-xs text-muted-foreground">
                  {m.sublabel}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setRemoved((prev) => new Set(prev).add(key));
                startTransition(async () => {
                  const res = await unmuteEntityAction({
                    entityType: m.entity_type,
                    entityId: m.entity_id,
                  });
                  if (!res.ok) {
                    // Put it back — a failed unmute that looks successful would
                    // leave the user believing they will hear about this again.
                    setRemoved((prev) => {
                      const next = new Set(prev);
                      next.delete(key);
                      return next;
                    });
                    toast.error(t("save_error"));
                  }
                });
              }}
            >
              {t("unmute")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
