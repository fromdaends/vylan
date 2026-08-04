import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ExternalLink, MessageSquare, Trash2, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RowMenuItems, DROPDOWN_MENU_PARTS } from "./row-menu-items";
import type { RowMenuItem } from "./engagement-row-menu";

// The founder's report: "the right click you didnt replicate the same ui. now
// its inconsistent." The cause was a shared item SHAPE with no shared RENDERER
// — the markup was pasted twice inside the worklist, so a third surface meant a
// third copy. These tests pin what the one renderer draws, which is what the
// engagements list and the tasks list now BOTH go through.

function open(items: RowMenuItem[]) {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <RowMenuItems items={items} parts={DROPDOWN_MENU_PARTS} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

afterEach(cleanup);

describe("RowMenuItems", () => {
  it("draws an icon beside every label", () => {
    open([
      { key: "open", label: "Open", icon: ExternalLink, onSelect: vi.fn() },
      { key: "c", label: "Add a comment", icon: MessageSquare, onSelect: vi.fn() },
    ]);
    for (const label of ["Open", "Add a comment"]) {
      const item = screen.getByText(label).closest("[role='menuitem']");
      expect(item).toBeTruthy();
      // The icon is an inline <svg> sibling of the label — its absence is
      // exactly what "you didn't replicate the same ui" looked like.
      expect(item!.querySelector("svg")).toBeTruthy();
    }
  });

  it("fences a destructive action behind a separator", () => {
    open([
      { key: "open", label: "Open", icon: ExternalLink, onSelect: vi.fn() },
      {
        key: "del",
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        onSelect: vi.fn(),
      },
    ]);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("does NOT open with a leading separator when destructive comes first", () => {
    // `i > 0` in the renderer — a menu whose only item is Delete must not begin
    // with a divider hanging off nothing.
    open([
      {
        key: "del",
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        onSelect: vi.fn(),
      },
    ]);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("renders a submenu parent rather than an action", () => {
    const onSelect = vi.fn();
    open([
      {
        key: "assign",
        label: "Assign to…",
        icon: UserRound,
        submenu: [{ key: "u1", label: "Tyler", checked: true, onSelect }],
      },
    ]);
    const trigger = screen.getByText("Assign to…");
    expect(trigger.closest("[role='menuitem']")).toBeTruthy();
    // The child list is closed until the parent is entered, so the member is
    // not on screen yet — the parent only opens the child.
    expect(screen.queryByText("Tyler")).toBeNull();
  });

  it("fires the item's own handler", () => {
    const onSelect = vi.fn();
    open([{ key: "c", label: "Add a comment", icon: MessageSquare, onSelect }]);
    fireEvent.click(screen.getByText("Add a comment"));
    expect(onSelect).toHaveBeenCalled();
  });
});
