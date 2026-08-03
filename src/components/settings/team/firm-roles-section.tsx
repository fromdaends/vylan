"use client";

// Where the firm's roles are made: Settings → Team → Settings.
//
// Create one with a name and a colour, rename it, recolour it, delete it.
// Handing it OUT happens on a person's own page, beside their permissions —
// the founder's standing rule that a control about a person belongs on that
// person, not on a firm-wide screen listing everybody.
//
// A role grants nothing. The note at the bottom says so, because "role" in this
// app already means the thing that decides what you may do, and a firm that
// assumed this was that would be badly surprised.
//
// FOUR THINGS HERE THAT NOBODY ASKED FOR AND THE SCREEN IS WORSE WITHOUT:
//
//   1. Starter roles. An empty list plus a blank text field is a dead end — you
//      have to invent a vocabulary before you can press anything. One click
//      each, and they disappear once used.
//   2. A head count per role. "Partner · 2" is the question you actually have
//      when looking at a list of labels, and it is the number that makes the
//      next item possible.
//   3. Deleting a role somebody wears asks first. Without the count it could
//      not: silently stripping five people's badges is not an undo you can see.
//   4. A live badge while you type, so the colour decision is made against the
//      thing itself rather than a swatch.

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  createRoleAction,
  updateRoleAction,
  deleteRoleAction,
  setRoleCapabilitiesAction,
} from "@/app/actions/firm-roles";
import { GRANTABLE_CAPABILITIES } from "@/lib/auth/grantable";

type Role = {
  id: string;
  name: string;
  color: string;
  count: number;
  capabilities: string[];
};

// What an accounting firm actually calls its people. Offered only while the
// firm has none — the moment there is one role, the firm has its own vocabulary
// and ours would be noise. Colours chosen so a full set does not read as one
// blur: seniority warm, function cool.
const STARTERS: { key: string; color: RoleColor }[] = [
  { key: "partner", color: "violet" },
  { key: "manager", color: "blue" },
  { key: "preparer", color: "emerald" },
  { key: "reviewer", color: "amber" },
  { key: "payroll", color: "cyan" },
];

export function FirmRolesSection({ roles }: { roles: Role[] }) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_ROLE_COLOR);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Role | null>(null);

  function report(res: { ok: boolean; needsMigration?: boolean; error?: string }) {
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

  async function create(roleName: string, roleColor: string) {
    if (!roleName.trim() || busy) return;
    setBusy(true);
    try {
      if (report(await createRoleAction({ name: roleName, color: roleColor }))) {
        setName("");
        setColor(DEFAULT_ROLE_COLOR);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: Role) {
    setConfirming(null);
    if (report(await deleteRoleAction({ roleId: role.id }))) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("roles_title")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("roles_hint")}</p>
      </div>

      {roles.length > 0 && (
        <ul className="space-y-2">
          {roles.map((r) =>
            editing === r.id ? (
              <li key={r.id}>
                <RoleEditor
                  role={r}
                  onDone={() => {
                    setEditing(null);
                    startTransition(() => router.refresh());
                  }}
                  onCancel={() => setEditing(null)}
                  report={report}
                />
              </li>
            ) : (
              <li key={r.id} className="group flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(r.id)}
                  className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("roles_edit", { name: r.name })}
                >
                  <RoleBadge name={r.name} color={r.color} />
                </button>
                {/* The head count. Absent rather than "0" when nobody wears it —
                    a zero beside every new role reads as a warning. */}
                {r.count > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" aria-hidden />
                    {r.count}
                  </span>
                )}
                {/* A role that grants something says so without being opened —
                    otherwise the only way to find out what a badge does is to
                    click every one of them. */}
                {r.capabilities.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3" aria-hidden />
                    {t("roles_grants_count", { count: r.capabilities.length })}
                  </span>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() =>
                    // Nobody wears it → nothing to lose, so no dialog. Somebody
                    // does → this strips their badge and there is no undo.
                    r.count > 0 ? setConfirming(r) : remove(r)
                  }
                  aria-label={t("roles_delete", { name: r.name })}
                  title={t("roles_delete", { name: r.name })}
                  className="rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {/* Somewhere to start. Only while the firm has none of its own. */}
      {roles.length === 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("roles_starters")}
          </span>
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
                name={t(`roles_starter_${s.key}` as Parameters<typeof t>[0])}
                color={s.color}
              />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={color} onChange={setColor} label={t("roles_color")} />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create(name, color);
            }
          }}
          placeholder={t("roles_name_placeholder")}
          maxLength={ROLE_NAME_MAX}
          aria-label={t("roles_name")}
          className="h-9 max-w-[16rem]"
        />
        <Button
          size="sm"
          onClick={() => create(name, color)}
          disabled={!name.trim() || busy}
        >
          <Plus className="size-4" />
          {t("roles_create")}
        </Button>
        {/* Decide the colour against the badge, not against a dot. */}
        {name.trim() && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden>→</span>
            <RoleBadge name={name.trim()} color={color} />
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t("roles_no_permissions")}</p>

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
              {t("roles_delete_body", { count: confirming?.count ?? 0 })}
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
    </section>
  );
}

function RoleEditor({
  role,
  onDone,
  onCancel,
  report,
}: {
  role: Role;
  onDone: () => void;
  onCancel: () => void;
  report: (r: { ok: boolean; needsMigration?: boolean; error?: string }) => boolean;
}) {
  const t = useTranslations("Team");
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [caps, setCaps] = useState<string[]>(role.capabilities);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <ColorPicker value={color} onChange={setColor} label={t("roles_color")} />
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        maxLength={ROLE_NAME_MAX}
        aria-label={t("roles_name")}
        className="h-9 max-w-[16rem]"
      />
      {name.trim() && <RoleBadge name={name.trim()} color={color} />}
      <span className="flex-1" />
      <Button
        size="sm"
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const renamed = await updateRoleAction({
              roleId: role.id,
              name,
              color,
            });
            if (!report(renamed)) return;
            // Two writes rather than one: the name/colour update is shared with
            // every other caller, and folding capabilities into it would make
            // an ordinary rename able to change what people may do.
            if (report(await setRoleCapabilitiesAction({ roleId: role.id, capabilities: caps }))) {
              onDone();
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <Check className="size-4" />
        {t("roles_save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t("roles_cancel")}
      </Button>
    </div>

    {/* What wearing this grants. Additive on top of whatever preset the person
        already has — a role can never take something away, so an unchecked box
        here means "this role does not add it", not "this role removes it". */}
    <fieldset className="space-y-1.5 border-t border-border/60 pt-2">
      <legend className="sr-only">{t("roles_grants")}</legend>
      <p className="text-xs text-muted-foreground">{t("roles_grants")}</p>
      {GRANTABLE_CAPABILITIES.map((cap) => (
        <label key={cap} className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={caps.includes(cap)}
            onChange={(e) =>
              setCaps((prev) =>
                e.target.checked
                  ? [...prev, cap]
                  : prev.filter((c) => c !== cap),
              )
            }
          />
          <span>
            {cap === "billing.manage"
              ? t("permissions_cap_billing")
              : t("permissions_cap_integrations")}
          </span>
        </label>
      ))}
    </fieldset>
    </div>
  );
}

// Eight swatches, not a hex field — see src/lib/roles/palette.ts for why.
function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (c: string) => void;
  label: string;
}) {
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">{label}</legend>
      {ROLE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          aria-pressed={value === c}
          className={`size-5 rounded-full ${roleSwatchClass(c)} transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === c
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "hover:scale-110"
          }`}
        />
      ))}
    </fieldset>
  );
}
