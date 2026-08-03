// Right-click on a file row opens the SAME actions the ⋯ button offers
// (Files v2 follow-up; founder: "Should be able to right click on files").
// Both shells render one shared item list — these tests pin that the
// context-menu shell actually opens and carries the full set.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  DocumentRowContextMenu,
  type DocumentMenuMeta,
} from "./document-actions-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/app/actions/documents", () => ({
  deleteDocumentAction: vi.fn(async () => ({ ok: true })),
  moveDocumentAction: vi.fn(async () => ({ ok: true })),
  renameDocumentAction: vi.fn(async () => ({ ok: true })),
  setDocumentVisibilityAction: vi.fn(async () => ({ ok: true })),
}));

const meta = (over: Partial<DocumentMenuMeta> = {}): DocumentMenuMeta => ({
  source: "imported",
  id: "d1",
  name: "T4_2025.pdf",
  year: 2025,
  category: "slips",
  docType: null,
  canMove: true,
  visibility: "firm",
  locale: "en",
  ...over,
});

function renderRow(over: Partial<DocumentMenuMeta> = {}) {
  return render(
    <DocumentRowContextMenu {...meta(over)}>
      <div>THE ROW</div>
    </DocumentRowContextMenu>,
  );
}

describe("DocumentRowContextMenu", () => {
  it("opens on right-click with the full action set", () => {
    renderRow();
    expect(screen.queryByText("action_download")).toBeNull();
    fireEvent.contextMenu(screen.getByText("THE ROW"));
    // The same items the ⋯ menu carries (mock renders raw keys).
    expect(screen.getByText("action_preview")).toBeInTheDocument();
    expect(screen.getByText("action_download")).toBeInTheDocument();
    expect(screen.getByText("action_make_client_visible")).toBeInTheDocument();
    expect(screen.getByText("action_rename")).toBeInTheDocument();
    expect(screen.getByText("action_move")).toBeInTheDocument();
    expect(screen.getByText("action_delete")).toBeInTheDocument();
  });

  it("never offers to hide a client's OWN upload", () => {
    renderRow({ source: "checklist" });
    fireEvent.contextMenu(screen.getByText("THE ROW"));
    expect(screen.getByText("action_download")).toBeInTheDocument();
    expect(screen.queryByText("action_make_firm_only")).toBeNull();
    expect(screen.queryByText("action_make_client_visible")).toBeNull();
  });

  it("opens the rename dialog from the menu", () => {
    renderRow();
    fireEvent.contextMenu(screen.getByText("THE ROW"));
    fireEvent.click(screen.getByText("action_rename"));
    expect(screen.getByText("rename_title")).toBeInTheDocument();
  });

  // Files HOME wraps a whole row LINK in this menu, so the recent-files rows
  // answer a right-click the same way Browse's rows do (founder: "you should
  // be able to right click on recent files"). Radix's asChild trigger clones
  // onto a single child, and getting that shape wrong renders an EMPTY row
  // rather than erroring — so pin that the link survives AND still opens.
  it("keeps a row link clickable and still opens on right-click", () => {
    render(
      <DocumentRowContextMenu {...meta()}>
        <div>
          {/* A bare anchor stands in for the row Link — this test is about
              the trigger keeping its child, not about routing. */}
          <a href="#row">T4_2025.pdf</a>
        </div>
      </DocumentRowContextMenu>,
    );
    const link = screen.getByRole("link", { name: "T4_2025.pdf" });
    expect(link).toHaveAttribute("href", "#row");

    fireEvent.contextMenu(link);
    expect(screen.getByText("action_rename")).toBeInTheDocument();
    expect(screen.getByText("action_delete")).toBeInTheDocument();
  });
});
