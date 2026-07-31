import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  screen,
  waitFor,
} from "@testing-library/react";
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
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: (...a: unknown[]) => toastInfo(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
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

import { moveFolderAction } from "@/app/actions/folders";
import { DraggableFile, DraggableFolder, FolderDropTarget } from "./drag-drop";

afterEach(() => {
  cleanup();
  toastInfo.mockReset();
  toastSuccess.mockReset();
  vi.mocked(moveFolderAction).mockReset();
});

/**
 * jsdom has no DataTransfer, so drags carry this stand-in. Unlike a bare
 * object, it actually STORES what dragstart writes — which is what lets a
 * whole drag→over→drop cycle run through the real components. `dropEffect`
 * is the outcome field: the browser sets "none" when no target accepted the
 * drop, "move" when one did (our dragover handler does exactly that).
 */
function dataTransfer(dropEffect: string) {
  const store = new Map<string, string>();
  return {
    dropEffect,
    effectAllowed: "move",
    get types() {
      return [...store.keys()];
    },
    setData(type: string, value: string) {
      store.set(type, String(value));
    },
    getData(type: string) {
      return store.get(type) ?? "";
    },
    setDragImage() {},
  };
}

/**
 * Dispatch a drag event carrying OUR dataTransfer object, un-copied.
 *
 * fireEvent.dragOver(node, { dataTransfer }) shallow-copies the dataTransfer
 * into each event — so when the dragover handler sets dropEffect = "move" it
 * writes to a copy, and the dragend event never sees the outcome. A real
 * browser threads ONE DataTransfer through the whole drag; this does the same.
 */
function fireDrag(node: Element, type: string, dt: unknown) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  return fireEvent(node, ev);
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
    fireDrag(row, "dragstart", dataTransfer("none"));
    fireDrag(row, "dragend", dataTransfer("none"));
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
    fireDrag(row, "dragstart", dataTransfer("none"));
    fireDrag(row, "dragend", dataTransfer("none"));
    expect(toastInfo).toHaveBeenCalledWith(en.Files.drag_dead_folder);
  });

  it("a file released over nothing says to drop it on a folder", () => {
    wrap(
      <DraggableFile source="checklist" id="d1" name="T4.pdf">
        <span>T4.pdf</span>
      </DraggableFile>,
    );
    const row = screen.getByText("T4.pdf").parentElement!;
    fireDrag(row, "dragstart", dataTransfer("none"));
    fireDrag(row, "dragend", dataTransfer("none"));
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
    fireDrag(row, "dragstart", dataTransfer("move"));
    fireDrag(row, "dragend", dataTransfer("move"));
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("all three dead-drop messages exist in both locales", () => {
    for (const key of ["drag_dead_file", "drag_dead_folder", "drag_dead_bucket"] as const) {
      expect(en.Files[key], `en ${key}`).toBeTruthy();
      expect(fr.Files[key], `fr ${key}`).toBeTruthy();
    }
  });
});

// The full cycle, through the REAL components: dragstart on a source row,
// dragover + drop on a target, then what the founder actually judges by —
// does the row leave the screen, and does the message tell the truth?
describe("a completed drop answers the source row", () => {
  function renderPair() {
    wrap(
      <>
        <DraggableFolder
          moves={{ kind: "folder", clientId: "c1", folderId: "src1" }}
          name="Payroll"
        >
          <span>Payroll</span>
        </DraggableFolder>
        <FolderDropTarget target={{ kind: "folder", folderId: "t1" }} label="Taxes">
          <span>Taxes</span>
        </FolderDropTarget>
      </>,
    );
    const source = screen.getByText("Payroll").parentElement!;
    const target = screen.getByText("Taxes").parentElement!;
    return { source, target };
  }

  function runDrop(source: HTMLElement, target: HTMLElement) {
    const dt = dataTransfer("none");
    fireDrag(source, "dragstart", dt);
    fireDrag(target, "dragover", dt); // sets dropEffect "move"
    fireDrag(target, "drop", dt);
    fireDrag(source, "dragend", dt);
    return dt;
  }

  it("a REAL move hides the source row instantly and says Moved", async () => {
    vi.mocked(moveFolderAction).mockResolvedValue({ ok: true });
    const { source, target } = renderPair();
    const dt = runDrop(source, target);

    expect(dt.dropEffect).toBe("move"); // the target accepted it
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Moved to Taxes.");
      // The row is GONE the moment the move is confirmed — not whenever the
      // page refresh gets around to redrawing the list.
      expect(source.className).toContain("hidden");
    });
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("a move to where it already is says Already — and the row STAYS", async () => {
    vi.mocked(moveFolderAction).mockResolvedValue({ ok: true, noop: true });
    const { source, target } = renderPair();
    runDrop(source, target);

    await waitFor(() => {
      expect(toastInfo).toHaveBeenCalledWith("Already in Taxes.");
    });
    // No lie, no vanish: nothing moved, so nothing disappears or dims.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(source.className).not.toContain("hidden");
    expect(source.className).not.toContain("opacity-40");
  });
});
