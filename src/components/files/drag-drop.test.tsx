import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// A DEAD DROP MUST ANSWER. These tests pin the one behavior that cannot be
// left to "tsc passed": releasing a drag over nothing (or over an invalid
// target) shows a message saying nothing moved and what to do instead, while
// a drop a target accepted stays silent — its own toast comes from the drop
// handler. The founder hit the silent version twice: a screen of derived year
// folders offers no valid target at all, and a gesture that ends in silence
// is indistinguishable from the feature being broken.

const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: (...a: unknown[]) => toastInfo(...a),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/documents", () => ({
  bulkMoveDocumentsAction: vi.fn(),
}));
vi.mock("@/app/actions/folders", () => ({
  moveBucketToFolderAction: vi.fn(),
  moveFolderAction: vi.fn(),
  setDocumentsFolderAction: vi.fn(),
}));

import { DraggableFile, DraggableFolder } from "./drag-drop";

afterEach(() => {
  cleanup();
  toastInfo.mockReset();
});

/**
 * jsdom has no DataTransfer, so drags carry this stand-in. `dropEffect` is
 * the field under test: the browser sets it to "none" when no target accepted
 * the drop, "move" when one did.
 */
function dataTransfer(dropEffect: string) {
  return {
    dropEffect,
    effectAllowed: "move",
    types: [] as string[],
    setData: () => {},
    getData: () => "",
    setDragImage: () => {},
  };
}

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("dead-drop feedback", () => {
  it("a year folder released over nothing explains that years are automatic", () => {
    wrap(
      <DraggableFolder
        moves={{ kind: "bucket", clientId: "c1", year: 2026, yearSet: true, label: "2026" }}
        name="2026"
      >
        <span>2026</span>
      </DraggableFolder>,
    );
    const row = screen.getByText("2026").parentElement!;
    fireEvent.dragStart(row, { dataTransfer: dataTransfer("none") });
    fireEvent.dragEnd(row, { dataTransfer: dataTransfer("none") });
    expect(toastInfo).toHaveBeenCalledWith(en.Files.drag_dead_bucket);
  });

  it("a custom folder released over nothing says to drop it on another folder", () => {
    wrap(
      <DraggableFolder
        moves={{ kind: "folder", clientId: "c1", folderId: "f1" }}
        name="Taxes"
      >
        <span>Taxes</span>
      </DraggableFolder>,
    );
    const row = screen.getByText("Taxes").parentElement!;
    fireEvent.dragStart(row, { dataTransfer: dataTransfer("none") });
    fireEvent.dragEnd(row, { dataTransfer: dataTransfer("none") });
    expect(toastInfo).toHaveBeenCalledWith(en.Files.drag_dead_folder);
  });

  it("a file released over nothing says to drop it on a folder", () => {
    wrap(
      <DraggableFile source="checklist" id="d1" name="T4.pdf">
        <span>T4.pdf</span>
      </DraggableFile>,
    );
    const row = screen.getByText("T4.pdf").parentElement!;
    fireEvent.dragStart(row, { dataTransfer: dataTransfer("none") });
    fireEvent.dragEnd(row, { dataTransfer: dataTransfer("none") });
    expect(toastInfo).toHaveBeenCalledWith(en.Files.drag_dead_file);
  });

  it("an ACCEPTED drop stays silent here — the drop handler owns that toast", () => {
    wrap(
      <DraggableFolder
        moves={{ kind: "bucket", clientId: "c1", year: 2026, yearSet: true, label: "2026" }}
        name="2026"
      >
        <span>2026</span>
      </DraggableFolder>,
    );
    const row = screen.getByText("2026").parentElement!;
    fireEvent.dragStart(row, { dataTransfer: dataTransfer("move") });
    fireEvent.dragEnd(row, { dataTransfer: dataTransfer("move") });
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("all three dead-drop messages exist in both locales", () => {
    for (const key of ["drag_dead_file", "drag_dead_folder", "drag_dead_bucket"] as const) {
      expect(en.Files[key], `en ${key}`).toBeTruthy();
      expect(fr.Files[key], `fr ${key}`).toBeTruthy();
    }
  });
});
