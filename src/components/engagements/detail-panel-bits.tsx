"use client";

// The pieces a detail panel is made of, drawn ONCE.
//
// There are two panels now — one for a task, one for an engagement — and they
// are the same object at two scopes: a labelled stack of fields, a row of
// segmented choices, a list of people you tick. When those were about to be
// written a second time, CLAUDE.md's cohesion rule applied literally: "Never
// create a second copy of UI that already exists. If a screen needs a slimmer
// version of an existing thing, add a prop/variant to the existing component."
//
// So restyling a field label, or the pressed state of a choice, moves BOTH
// panels. That is the whole point — the alternative is the drift where the
// task panel's ticked checkbox and the engagement panel's ticked checkbox
// start out identical and diverge the first time either is touched.

import { Check } from "lucide-react";

import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

/** A labelled section of a panel. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * One choice in a segmented row (a status, a priority).
 *
 * `grow` is the only difference between the two existing uses: priorities
 * divide the row evenly, statuses take their natural width and wrap — a firm
 * that names nine statuses (1420) cannot fit them in equal columns.
 */
export function OptionButton({
  on,
  disabled,
  onClick,
  dotColor,
  grow = false,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Shows a colour dot before the label — the firm's own status colour. */
  dotColor?: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:opacity-50",
        dotColor !== undefined && "flex items-center gap-1.5",
        grow && "flex-1",
        on
          ? "border-foreground/30 bg-secondary font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {dotColor !== undefined && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

/**
 * A person you can tick on or off.
 *
 * ⚠️ `single` renders a RADIO rather than a checkbox, because an engagement
 * has exactly one assignee today (`engagements.assigned_user_id`) while a task
 * has many. Drawing a checkbox for a single-select would promise a second tick
 * the server will refuse — the control has to tell the truth about the data
 * model underneath it. When engagements grow a real many-side, this flips to
 * `single={false}` and nothing else here changes.
 */
export function PersonCheckRow({
  name,
  on,
  disabled,
  onClick,
  single = false,
}: {
  name: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  single?: boolean;
}) {
  return (
    <button
      type="button"
      role={single ? "radio" : "checkbox"}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center border",
          single ? "rounded-full" : "rounded-[4px]",
          on ? "border-foreground bg-foreground text-background" : "border-border",
        )}
      >
        {on &&
          (single ? (
            <span className="size-1.5 rounded-full bg-background" aria-hidden />
          ) : (
            <Check className="size-3" aria-hidden />
          ))}
      </span>
      <AvatarInitials name={name} size={20} />
      <span className="truncate">{name}</span>
    </button>
  );
}
