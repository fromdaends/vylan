"use client";

// Roles, as a place you go rather than a paragraph in settings.
//
// The founder's reference is Discord's Server Settings → Roles, screenshot by
// screenshot: a list of roles down the left with a + above it, and on the right
// an EDIT ROLE header over three tabs — Display, Permissions, Manage Members.
// What we had was a create-field and a list inside the firm settings tab, which
// is the shape you build when roles are decoration and the wrong one now that
// they carry permissions.
//
// TABS ARE CLIENT STATE HERE, and that is deliberate against this app's usual
// rule that a tab should be a URL. Everything all three tabs render is already
// loaded — roles, the roster, and who holds what — so a server round trip per
// tab would buy a linkable URL at the cost of the exact latency the founder
// complained about on the client page. The SELECTED ROLE is in the URL, because
// that is the thing worth linking to.
//
// Discord's "Role Style" (gradient / holographic) is a paid upsell there. Not
// replicated: solid colours only, and no locked row dangling a purchase.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoleBadge } from "./role-badge";
import {
  ROLE_COLORS,
  DEFAULT_ROLE_COLOR,
  ROLE_NAME_MAX,
  roleSwatchClass,
  type RoleColor,
} from "@/lib/roles/palette";
import { GRANTABLE_CAPABILITIES } from "@/lib/auth/grantable";
import {
  createRoleAction,
  updateRoleAction,
  deleteRoleAction,
  setRoleCapabilitiesAction,
  setUserRoleAction,
} from "@/app/actions/firm-roles";

type Role = {
  id: string;
  name: string;
  color: string;
  capabilities: string[];
  memberIds: string[];
};
type Person = { id: string; name: string; email: string };
type Tab = "display" | "permissions" | "members";

// What an accounting firm actually calls its people, offered only while the
// firm has none of its own — an empty list plus a blank field means inventing a
// vocabulary before you can press anything.
const STARTERS: { key: string; color: RoleColor }[] = [
  { key: "partner", color: "violet" },
  { key: "manager", color: "blue" },
  { key: "preparer", color: "emerald" },
  { key: "reviewer", color: "amber" },
  { key: "payroll", color: "cyan" },
];

export function RolesWorkbench({
  roles,
  people,
  selectedId,
}: {
  roles: Role[];
  people: Person[];
  selectedId: string | null;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("display");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Role | null>(null);

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;

  function report(res: {
    ok: boolean;
    needsMigration?: boolean;
    error?: string;
  }) {
    if (res.ok) return true;
    toast.error(
      res.needsMigration
        ? t("roles_needs_migration")
        : res.error === "duplicate"
          ? t("roles_duplicate")
          : res.error === "bad_name"
            ? t("roles_bad_name")
            : t("roles_failed"),
    );
    return false;
  }

  const select = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("role", id);
    startTransition(() => router.replace(url.pathname + url.search));
  };

  async function create(name: string, color: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (report(await createRoleAction({ name, color }))) {
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start">
      {/* ── The role list ─────────────────────────────────────────────── */}
      <div className="space-y-2 lg:sticky lg:top-6">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {t("roles_title")}
          </span>
          <button
            type="button"
            onClick={() => create(t("roles_new_name"), DEFAULT_ROLE_COLOR)}
            disabled={busy}
            aria-label={t("roles_create")}
            title={t("roles_create")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>

        {roles.length === 0 ? (
          <div className="space-y-2 px-1">
            <p className="text-sm text-muted-foreground">
              {t("roles_none_yet_page")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    create(
                      t(`roles_starter_${s.key}` as Parameters<typeof t>[0]),
                      s.color,
                    )
                  }
                  className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <RoleBadge
                    name={t(
                      `roles_starter_${s.key}` as Parameters<typeof t>[0],
                    )}
                    color={s.color}
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => select(r.id)}
                  aria-current={selected?.id === r.id ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected?.id === r.id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${roleSwatchClass(r.color)}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {r.memberIds.length > 0 && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {r.memberIds.length}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── The editor ────────────────────────────────────────────────── */}
      {selected ? (
        <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 pt-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {t("roles_edit_heading")}
              </p>
              <h2 className="mt-0.5 flex items-center gap-2 text-lg font-semibold">
                <RoleBadge name={selected.name} color={selected.color} />
              </h2>
            </div>
            <button
              type="button"
              onClick={() =>
                selected.memberIds.length > 0
                  ? setConfirming(selected)
                  : remove(selected)
              }
              aria-label={t("roles_delete", { name: selected.name })}
              title={t("roles_delete", { name: selected.name })}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
            <nav
              className="-mb-px flex w-full gap-1"
              aria-label={t("roles_title")}
            >
              {(
                [
                  ["display", t("roles_tab_display")],
                  ["permissions", t("roles_tab_permissions")],
                  [
                    "members",
                    t("roles_tab_members", {
                      count: selected.memberIds.length,
                    }),
                  ],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? "page" : undefined}
                  className={`border-b-2 px-3 pb-2.5 text-sm transition-colors ${
                    tab === key
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-4">
            {tab === "display" && (
              <DisplayTab
                role={selected}
                report={report}
                onSaved={() => startTransition(() => router.refresh())}
              />
            )}
            {tab === "permissions" && (
              <PermissionsTab
                role={selected}
                report={report}
                onSaved={() => startTransition(() => router.refresh())}
              />
            )}
            {tab === "members" && (
              <MembersTab
                role={selected}
                people={people}
                report={report}
                onSaved={() => startTransition(() => router.refresh())}
              />
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-border/60 p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("roles_pick_one")}</p>
        </section>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("roles_delete_title", { name: confirming?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t("roles_delete_body", {
                count: confirming?.memberIds.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t("roles_cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirming && remove(confirming)}
            >
              {t("roles_delete_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  async function remove(role: Role) {
    setConfirming(null);
    if (report(await deleteRoleAction({ roleId: role.id }))) {
      const url = new URL(window.location.href);
      url.searchParams.delete("role");
      startTransition(() => {
        router.replace(url.pathname + url.search);
        router.refresh();
      });
    }
  }
}

// ── Display ─────────────────────────────────────────────────────────────────

function DisplayTab({
  role,
  report,
  onSaved,
}: {
  role: Role;
  report: (r: {
    ok: boolean;
    needsMigration?: boolean;
    error?: string;
  }) => boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("Team");
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== role.name || color !== role.color;

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (report(await updateRoleAction({ roleId: role.id, name, color }))) {
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  // Two columns once there is room: the fields you edit on the left, the badge
  // you are editing on the right. One column with a preview stranded under it
  // left the right half of the card empty and made you scroll to see the thing
  // you were changing.
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] lg:gap-10">
      <div className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="role-name" className="text-sm font-medium">
          {t("roles_name")} <span className="text-destructive">*</span>
        </label>
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          maxLength={ROLE_NAME_MAX}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          {t("roles_color")} <span className="text-destructive">*</span>
        </p>
        <p className="text-xs text-muted-foreground">{t("roles_color_hint")}</p>
        <fieldset className="mt-2 flex flex-wrap gap-2">
          <legend className="sr-only">{t("roles_color")}</legend>
          {ROLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              aria-pressed={color === c}
              className={`size-8 rounded-md ${roleSwatchClass(c)} transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                color === c
                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                  : "hover:scale-105"
              }`}
            />
          ))}
        </fieldset>
      </div>

      {dirty && (
        <Button onClick={save} disabled={!name.trim() || busy}>
          {t("roles_save")}
        </Button>
      )}
      </div>

      {/* The preview shows the badge in the two places it actually appears —
          on a roster row and beside a name — rather than floating alone, so
          a colour you pick is judged where you will read it. */}
      <div className="space-y-1.5 lg:sticky lg:top-6">
        <p className="text-sm font-medium">{t("roles_preview")}</p>
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          <RoleBadge name={name.trim() || role.name} color={color} />
          <div className="flex items-center gap-2.5 border-t border-border/60 pt-3">
            <AvatarInitials name={role.name} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {t("roles_preview_person")}
              </span>
              <span className="mt-0.5 block">
                <RoleBadge name={name.trim() || role.name} color={color} />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Permissions ─────────────────────────────────────────────────────────────

function PermissionsTab({
  role,
  report,
  onSaved,
}: {
  role: Role;
  report: (r: {
    ok: boolean;
    needsMigration?: boolean;
    error?: string;
  }) => boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("Team");
  const [caps, setCaps] = useState<string[]>(role.capabilities);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const label = (cap: string) =>
    cap === "billing.manage"
      ? t("permissions_cap_billing")
      : t("permissions_cap_integrations");

  const shown = useMemo(
    () =>
      GRANTABLE_CAPABILITIES.filter((c) =>
        label(c).toLowerCase().includes(query.trim().toLowerCase()),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query],
  );

  async function commit(next: string[]) {
    setCaps(next);
    setBusy(true);
    try {
      if (
        report(
          await setRoleCapabilitiesAction({
            roleId: role.id,
            capabilities: next,
          }),
        )
      ) {
        onSaved();
      } else {
        setCaps(role.capabilities);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("roles_search_permissions")}
            aria-label={t("roles_search_permissions")}
            className="pl-8"
          />
        </div>
        {caps.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => commit([])}
            disabled={busy}
          >
            {t("roles_clear_permissions")}
          </Button>
        )}
      </div>

      {/* Additive only — an off switch means "this role does not add it", never
          "this role removes it". Said once, above the list. */}
      <p className="text-xs text-muted-foreground">
        {t("roles_additive_note")}
      </p>

      <ul className="divide-y divide-border/60">
        {shown.map((cap) => {
          const on = caps.includes(cap);
          return (
            <li
              key={cap}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{label(cap)}</p>
              </div>
              {/* The app's own toggle, not a hand-rolled one. Its header even
                  says "Discord-style toggle" — it was already the right piece
                  and a second copy only meant a second set of bugs. */}
              <Switch
                checked={on}
                ariaLabel={label(cap)}
                disabled={busy}
                onCheckedChange={(next) =>
                  commit(next ? [...caps, cap] : caps.filter((c) => c !== cap))
                }
              />
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            {t("roles_no_permission_match")}
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Manage members ──────────────────────────────────────────────────────────

function MembersTab({
  role,
  people,
  report,
  onSaved,
}: {
  role: Role;
  people: Person[];
  report: (r: {
    ok: boolean;
    needsMigration?: boolean;
    error?: string;
  }) => boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("Team");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const held = new Set(role.memberIds);
  const members = people.filter((p) => held.has(p.id));
  const candidates = people.filter((p) => !held.has(p.id));

  const q = query.trim().toLowerCase();
  const shown = (adding ? candidates : members).filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q),
  );

  async function toggle(userId: string, on: boolean) {
    setBusy(userId);
    try {
      if (report(await setUserRoleAction({ userId, roleId: role.id, on }))) {
        onSaved();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("roles_search_members")}
            aria-label={t("roles_search_members")}
            className="pl-8"
          />
        </div>
        <Button
          size="sm"
          variant={adding ? "secondary" : "default"}
          onClick={() => {
            setAdding((a) => !a);
            setQuery("");
          }}
        >
          <UserPlus className="size-4" aria-hidden />
          {adding ? t("roles_done_adding") : t("roles_add_members")}
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {adding ? t("roles_everyone_has_it") : t("roles_no_members")}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <AvatarInitials name={p.name} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.email}
                </span>
              </span>
              {adding ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === p.id}
                  onClick={() => toggle(p.id, true)}
                >
                  {t("roles_add")}
                </Button>
              ) : (
                <button
                  type="button"
                  disabled={busy === p.id}
                  onClick={() => toggle(p.id, false)}
                  aria-label={t("roles_remove_member", { name: p.name })}
                  title={t("roles_remove_member", { name: p.name })}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
