import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  CommentThread,
  commentKeyForFile,
  commentKeyForItem,
  openCommentComposer,
  type CommentTarget,
} from "./comment-thread";
import type { FileComment } from "@/lib/db/file-comments";
import en from "../../../messages/en.json";

// Radix Popover leans on a few DOM APIs the test DOM doesn't implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

const addMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/app/actions/file-comments", () => ({
  addFileCommentAction: (...args: unknown[]) => addMock(...args),
  deleteFileCommentAction: (...args: unknown[]) => deleteMock(...args),
}));

const members = [
  { id: "u-me", name: "Tyler" },
  { id: "u-zach", name: "Zach" },
];

const existing: FileComment[] = [
  {
    id: "c1",
    uploadedFileId: null,
    requestItemId: "i1",
    authorUserId: "u-zach",
    authorName: "Zach",
    body: "Missing page 2 here",
    mentions: [],
    createdAt: "2026-07-27T10:00:00Z",
  },
];

function renderThread(
  target: CommentTarget = { kind: "item", itemId: "i1" },
  initialComments: FileComment[] = [],
  quotedText = "T4 slips",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CommentThread
        engagementId="e1"
        target={target}
        initialComments={initialComments}
        members={members}
        currentUserId="u-me"
        locale="en"
        quotedText={quotedText}
      />
    </NextIntlClientProvider>,
  );
}

const openCard = () => act(() => openCommentComposer(commentKeyForItem("i1")));

beforeEach(() => {
  addMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CommentThread — the row's margin bubble", () => {
  it("renders NOTHING when there are no comments and nobody asked to write", () => {
    const { container } = renderThread();
    expect(container.innerHTML).toBe("");
  });

  it("shows a bubble carrying the comment count once comments exist", () => {
    renderThread({ kind: "item", itemId: "i1" }, existing);
    const bubble = screen.getByRole("button", { name: /1 comment/i });
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveTextContent("1");
    // Nothing is spilled onto the row itself — the thread lives in the card.
    expect(screen.queryByText("Missing page 2 here")).not.toBeInTheDocument();
  });

  it("opens the card on click, quoting what was commented on", async () => {
    renderThread({ kind: "item", itemId: "i1" }, existing);
    fireEvent.click(screen.getByRole("button", { name: /1 comment/i }));
    await waitFor(() =>
      expect(screen.getByText("Missing page 2 here")).toBeInTheDocument(),
    );
    expect(screen.getByText("Zach")).toBeInTheDocument();
    // The quoted target line (Notion's echo of the commented thing).
    expect(screen.getByText("T4 slips")).toBeInTheDocument();
  });
});

describe("CommentThread — the composer", () => {
  it("opens on demand for its own target only", async () => {
    renderThread({ kind: "item", itemId: "i1" });
    act(() => openCommentComposer(commentKeyForFile("some-file")));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    openCard();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
  });

  it("Enter posts against the right target and keeps the card open", async () => {
    addMock.mockResolvedValue({
      ok: true,
      comment: {
        id: "c9",
        uploadedFileId: null,
        requestItemId: "i1",
        authorUserId: "u-me",
        authorName: "Tyler",
        body: "On it",
        mentions: [],
        createdAt: "2026-07-28T09:00:00Z",
      },
    });
    renderThread({ kind: "item", itemId: "i1" });
    openCard();
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "On it" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("On it")).toBeInTheDocument());
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engagementId: "e1",
        uploadedFileId: null,
        requestItemId: "i1",
        body: "On it",
      }),
    );
    // Notion keeps the thread up after a reply; the box just empties.
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("a file-target thread posts with its file id", async () => {
    addMock.mockResolvedValue({
      ok: true,
      comment: {
        id: "c10",
        uploadedFileId: "f1",
        requestItemId: null,
        authorUserId: "u-me",
        authorName: "Tyler",
        body: "Wrong year?",
        mentions: [],
        createdAt: "2026-07-28T09:00:00Z",
      },
    });
    renderThread({ kind: "file", fileId: "f1" }, [], "T4-2025.pdf");
    act(() => openCommentComposer(commentKeyForFile("f1")));
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "Wrong year?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ uploadedFileId: "f1", requestItemId: null }),
      ),
    );
  });

  it("the send arrow stays disabled until something is typed", async () => {
    renderThread({ kind: "item", itemId: "i1" });
    openCard();
    const send = await screen.findByRole("button", {
      name: en.Team.comment_post,
    });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hey" } });
    expect(send).toBeEnabled();
  });

  it("typing @ offers teammates under a People heading, never yourself", async () => {
    renderThread({ kind: "item", itemId: "i1" });
    openCard();
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "hey @" } });
    await waitFor(() =>
      expect(
        screen.getByText(en.Team.mention_section_people),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Zach")).toBeInTheDocument();
    // "Tyler" is the viewer — you can't mention yourself.
    expect(screen.queryByText("Tyler")).not.toBeInTheDocument();
  });
});

describe("CommentThread — deleting", () => {
  it("offers delete on your own comment only", async () => {
    const mine: FileComment = {
      ...existing[0]!,
      id: "c2",
      authorUserId: "u-me",
      authorName: "Tyler",
      body: "my note",
    };
    renderThread({ kind: "item", itemId: "i1" }, [existing[0]!, mine]);
    fireEvent.click(screen.getByRole("button", { name: /2 comments/i }));
    await waitFor(() => expect(screen.getByText("my note")).toBeInTheDocument());
    expect(
      screen.getAllByRole("button", { name: en.Team.comment_delete }),
    ).toHaveLength(1);
  });

  it("closes the card and clears the bubble when the last comment goes", async () => {
    deleteMock.mockResolvedValue({ ok: true });
    const mine: FileComment = {
      ...existing[0]!,
      id: "c2",
      authorUserId: "u-me",
      authorName: "Tyler",
      body: "my note",
    };
    const { container } = renderThread({ kind: "item", itemId: "i1" }, [mine]);
    fireEvent.click(screen.getByRole("button", { name: /1 comment/i }));
    await waitFor(() => expect(screen.getByText("my note")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", { name: en.Team.comment_delete }),
    );
    // Back to a perfectly clean row.
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
