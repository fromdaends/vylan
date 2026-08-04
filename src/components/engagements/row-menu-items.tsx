"use client";

// The rendered body of a row menu — ONE implementation, for every row menu.
//
// WHY THIS FILE EXISTS. The founder, after tasks got their own right-click
// entry: "the right click you didnt replicate the same ui. now its inconsistent
// look at the screenshot i just sent thats the ui it should look like."
//
// They were right, and the cause is worth recording: `RowMenuItem[]` was a
// shared SHAPE with no shared RENDERER. The markup that turns those items into
// icons, submenus and a fenced destructive group was copy-pasted twice inside
// engagements-worklist (once for the "..." dropdown, once for the right-click
// menu). So the only way to give tasks the same menu was to paste it a third
// time — and a third copy is a third thing that drifts.
//
// Now the shape and the look travel together. Restyling a row menu is one edit
// and it lands on the engagements list, the tasks list, and anything added next.
//
// THE PRIMITIVES ARE INJECTED because Radix's dropdown and context menus are
// different component families that happen to render the same thing. Passing
// them in is what lets one renderer serve both without knowing which it is.

import { Fragment } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { RowMenuItem } from "@/components/engagements/engagement-row-menu";

type MenuParts = {
  Item: React.ElementType;
  Separator: React.ElementType;
  Sub: React.ElementType;
  SubTrigger: React.ElementType;
  SubContent: React.ElementType;
};

export const CONTEXT_MENU_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const DROPDOWN_MENU_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export function RowMenuItems({
  items,
  parts,
}: {
  items: RowMenuItem[];
  parts: MenuParts;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = parts;
  return (
    <>
      {items.map((it, i) => {
        const Icon = it.icon;
        // A submenu item (Assign to… / Change stage / Change status) opens a
        // child list instead of acting on click.
        if (it.submenu) {
          return (
            <Sub key={it.key}>
              <SubTrigger>
                <Icon />
                {it.label}
              </SubTrigger>
              <SubContent className="w-52">
                {it.submenu.map((sub) => (
                  <Item key={sub.key} onSelect={sub.onSelect} className="gap-2">
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", sub.dotClass)}
                      style={
                        sub.dotColor ? { backgroundColor: sub.dotColor } : undefined
                      }
                    />
                    <span className="flex-1">{sub.label}</span>
                    {sub.checked && (
                      <Check className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </Item>
                ))}
              </SubContent>
            </Sub>
          );
        }
        return (
          <Fragment key={it.key}>
            {/* Destructive actions get their own group, the way Drive fences
                off "Move to trash" — a stray click on Delete is the one that
                actually costs something. */}
            {it.variant === "destructive" && i > 0 && <Separator />}
            <Item variant={it.variant} onSelect={it.onSelect}>
              <Icon />
              {it.label}
            </Item>
          </Fragment>
        );
      })}
    </>
  );
}
