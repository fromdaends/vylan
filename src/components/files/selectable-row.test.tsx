// The Drive selection model (Files v2 §7): single click SELECTS, double
// click OPENS, Esc clears, and controls inside a row keep their own clicks.
// These are behavioral promises to the founder — a regression here brings
// back "every click is a page load".

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileSelectionProvider, useFileSelection } from "./file-selection";
import { RowsSurface, SelectableRow } from "./selectable-row";

const push = vi.fn();
const open = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/documents", () => ({
  bulkDeleteDocumentsAction: vi.fn(async () => ({
    ok: true,
    succeeded: 1,
    failed: 0,
    skipped: 0,
  })),
  restoreDocumentAction: vi.fn(async () => ({ ok: true })),
}));

/** Exposes the provider's selection size so tests can assert on it. */
function SelectionSize() {
  const sel = useFileSelection();
  return <output data-testid="size">{sel?.selected.size ?? -1}</output>;
}

function renderRows() {
  window.open = open;
  return render(
    <FileSelectionProvider>
      <SelectionSize />
      <RowsSurface
        orderedFiles={[
          { source: "checklist", id: "d1" },
          { source: "checklist", id: "d2" },
          { source: "imported", id: "d3" },
        ]}
      >
        <SelectableRow
          kind="folder"
          rowKey="f1"
          name="Folder One"
          href="/files?client=c1"
          manage={{ clientId: "c1", folderId: "f1" }}
        >
          <div>Folder One</div>
        </SelectableRow>
        <SelectableRow
          kind="file"
          rowKey="checklist-d1"
          source="checklist"
          id="d1"
          previewUrl="/api/files/d1?source=checklist"
        >
          <div>
            File One
            <button>menu</button>
          </div>
        </SelectableRow>
        <SelectableRow kind="file" rowKey="checklist-d2" source="checklist" id="d2">
          <div>File Two</div>
        </SelectableRow>
        <SelectableRow kind="file" rowKey="imported-d3" source="imported" id="d3">
          <div>File Three</div>
        </SelectableRow>
      </RowsSurface>
    </FileSelectionProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  open.mockClear();
});

describe("SelectableRow", () => {
  it("selects a folder on single click and STAYS selected on a re-click", () => {
    renderRows();
    const row = screen.getByText("Folder One").parentElement!;
    fireEvent.click(row);
    expect(row).toHaveAttribute("data-selected");
    expect(push).not.toHaveBeenCalled();
    // Drive never deselects on a re-click — the founder's exact report was
    // "when you click it a second time it shouldn't close". Esc clears.
    fireEvent.click(row);
    expect(row).toHaveAttribute("data-selected");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(row).not.toHaveAttribute("data-selected");
  });

  it("keeps a file selected on a plain re-click too", () => {
    renderRows();
    const row = screen.getByText(/File One/).parentElement!;
    fireEvent.click(row);
    fireEvent.click(row);
    expect(row).toHaveAttribute("data-selected");
    expect(screen.getByTestId("size").textContent).toBe("1");
  });

  it("opens a folder on double click, not single", () => {
    renderRows();
    const row = screen.getByText("Folder One").parentElement!;
    fireEvent.doubleClick(row);
    expect(push).toHaveBeenCalledWith("/files?client=c1");
  });

  it("feeds file clicks into the bulk-selection provider", () => {
    renderRows();
    const row = screen.getByText(/File One/).parentElement!;
    fireEvent.click(row);
    expect(screen.getByTestId("size").textContent).toBe("1");
    expect(row).toHaveAttribute("data-selected");
  });

  it("opens the file preview on double click", () => {
    renderRows();
    fireEvent.doubleClick(screen.getByText(/File One/).parentElement!);
    expect(open).toHaveBeenCalledWith(
      "/api/files/d1?source=checklist",
      "_blank",
      "noopener",
    );
  });

  it("leaves clicks on inner controls alone", () => {
    renderRows();
    fireEvent.click(screen.getByText("menu"));
    expect(screen.getByTestId("size").textContent).toBe("0");
  });

  it("clears everything on Escape", () => {
    renderRows();
    fireEvent.click(screen.getByText(/File One/).parentElement!);
    expect(screen.getByTestId("size").textContent).toBe("1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("size").textContent).toBe("0");
  });

  it("pops the action bar when a folder is selected — Open/Rename/Delete", () => {
    renderRows();
    // Nothing selected: no bar.
    expect(screen.queryByText("action_open")).toBeNull();
    fireEvent.click(screen.getByText("Folder One").parentElement!);
    // Folder mode: the bar names the folder and offers its actions
    // (the next-intl mock renders raw keys).
    expect(screen.getByText("action_open")).toBeInTheDocument();
    expect(screen.getByText("action_rename")).toBeInTheDocument();
    expect(screen.getByText("action_delete")).toBeInTheDocument();
  });

  it("pops the bulk bar when a file is selected", () => {
    renderRows();
    fireEvent.click(screen.getByText(/File One/).parentElement!);
    expect(screen.getByText("bulk_selected")).toBeInTheDocument();
    expect(screen.getByText("action_download")).toBeInTheDocument();
  });

  it("shift-click selects the whole range from the anchor", () => {
    renderRows();
    fireEvent.click(screen.getByText(/File One/).parentElement!);
    fireEvent.click(screen.getByText("File Three").parentElement!, {
      shiftKey: true,
    });
    expect(screen.getByTestId("size").textContent).toBe("3");
    expect(screen.getByText("File Two").parentElement!).toHaveAttribute(
      "data-selected",
    );
  });

  it("a later shift-click re-ranges from the SAME anchor", () => {
    renderRows();
    fireEvent.click(screen.getByText(/File One/).parentElement!);
    fireEvent.click(screen.getByText("File Three").parentElement!, {
      shiftKey: true,
    });
    // Narrow the range: anchor is still File One.
    fireEvent.click(screen.getByText("File Two").parentElement!, {
      shiftKey: true,
    });
    expect(screen.getByTestId("size").textContent).toBe("2");
    expect(screen.getByText("File Three").parentElement!).not.toHaveAttribute(
      "data-selected",
    );
  });

  it("shift-click with no anchor selects just that row", () => {
    renderRows();
    fireEvent.click(screen.getByText("File Two").parentElement!, {
      shiftKey: true,
    });
    expect(screen.getByTestId("size").textContent).toBe("1");
  });

  it("selecting a folder clears file selection, and vice versa", () => {
    renderRows();
    const folder = screen.getByText("Folder One").parentElement!;
    const file = screen.getByText(/File One/).parentElement!;
    fireEvent.click(file);
    fireEvent.click(folder);
    expect(screen.getByTestId("size").textContent).toBe("0");
    expect(folder).toHaveAttribute("data-selected");
    fireEvent.click(file);
    expect(folder).not.toHaveAttribute("data-selected");
    expect(file).toHaveAttribute("data-selected");
  });
});
