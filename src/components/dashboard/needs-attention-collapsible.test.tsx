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

  it("collapses on click and flips aria-expanded (session-only, nothing persisted)", () => {
    renderShell(3);
    const btn = screen.getByRole("button", { name: /Needs attention/ });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById("needs-attention-body");
    expect(body?.getAttribute("style")).toContain("0fr");
    // The choice is deliberately NOT remembered across loads.
    expect(localStorage.getItem("vylan:needs-attention-collapsed")).toBeNull();
  });

  it("re-expands on a second click", () => {
    renderShell(3);
    const btn = screen.getByRole("button", { name: /Needs attention/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("IGNORES a legacy saved 'collapsed' preference — always opens expanded", () => {
    // Pre-rework builds persisted the collapse to localStorage, which kept the
    // block shut on every page load. The block must now open regardless.
    localStorage.setItem("vylan:needs-attention-collapsed", "true");
    renderShell(2);
    expect(
      screen.getByRole("button", { name: /Needs attention/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Row content")).toBeInTheDocument();
  });

  it("keeps the count badge visible while collapsed", () => {
    renderShell(5);
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("hides the count badge when nothing needs attention and shows the calm empty body", () => {
    render(
      <NeedsAttentionCollapsible title="Needs attention" count={0}>
        <p>All caught up</p>
      </NeedsAttentionCollapsible>,
    );
    expect(screen.queryByText("0")).toBeNull();
    // Open by default, so the one-line empty state is visible, not a blank.
    expect(screen.getByText("All caught up")).toBeInTheDocument();
  });
});
