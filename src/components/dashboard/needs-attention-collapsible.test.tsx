import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NeedsAttentionCollapsible } from "./needs-attention-collapsible";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell(count: number) {
  return render(
    <NeedsAttentionCollapsible title="Needs attention" count={count}>
      <ul>
        <li>Row content</li>
      </ul>
    </NeedsAttentionCollapsible>,
  );
}

describe("NeedsAttentionCollapsible", () => {
  it("renders the header (title + count) and is expanded by default", () => {
    renderShell(5);
    const btn = screen.getByRole("button", { name: /Needs attention/ });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Row content")).toBeInTheDocument();
    const body = document.getElementById("needs-attention-body");
    expect(body?.getAttribute("style")).toContain("1fr");
  });

  it("collapses on click, flips aria-expanded, persists the choice, and snaps the body shut", () => {
    renderShell(3);
    const btn = screen.getByRole("button", { name: /Needs attention/ });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("vylan:needs-attention-collapsed")).toBe(
      "true",
    );
    const body = document.getElementById("needs-attention-body");
    expect(body?.getAttribute("style")).toContain("0fr");
  });

  it("restores a previously-collapsed state from localStorage on mount", () => {
    localStorage.setItem("vylan:needs-attention-collapsed", "true");
    renderShell(2);
    expect(
      screen.getByRole("button", { name: /Needs attention/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the count badge visible while collapsed", () => {
    localStorage.setItem("vylan:needs-attention-collapsed", "true");
    renderShell(5);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("hides the count badge when nothing needs attention", () => {
    render(
      <NeedsAttentionCollapsible title="Needs attention" count={0}>
        <p>All caught up</p>
      </NeedsAttentionCollapsible>,
    );
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("All caught up")).toBeInTheDocument();
  });
});
