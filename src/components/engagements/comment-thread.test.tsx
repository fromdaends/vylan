import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  addMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CommentThread (pure commenting)", () => {
  it("renders NOTHING when there are no comments and no one asked to write", () => {
    const { container } = renderThread();
    expect(container.innerHTML).toBe("");
  });

  it("renders existing comments as bare lines — no composer, no panel chrome", () => {
    renderThread({ kind: "item", itemId: "i1" }, existing);
    expect(screen.getByText("Zach")).toBeInTheDocument();
    expect(screen.getByText("Missing page 2 here")).toBeInTheDocument();
    // Pure: no textarea until explicitly opened.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens its composer only for its own target key", () => {
    renderThread({ kind: "item", itemId: "i1" });
    act(() => openCommentComposer(commentKeyForFile("some-file")));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    act(() => openCommentComposer(commentKeyForItem("i1")));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Enter posts to the right target and the comment appears; composer closes", async () => {
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
    act(() => openCommentComposer(commentKeyForItem("i1")));

    const box = screen.getByRole("textbox");
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
    // Pure again after posting — the input is gone.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
    renderThread({ kind: "file", fileId: "f1" });
    act(() => openCommentComposer(commentKeyForFile("f1")));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Wrong year?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ uploadedFileId: "f1", requestItemId: null }),
      ),
    );
  });

  it("Escape walks away and leaves nothing behind", () => {
    const { container } = renderThread({ kind: "item", itemId: "i1" });
    act(() => openCommentComposer(commentKeyForItem("i1")));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "half a thought" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.innerHTML).toBe("");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("blurring an empty composer closes it quietly", () => {
    const { container } = renderThread({ kind: "item", itemId: "i1" });
    act(() => openCommentComposer(commentKeyForItem("i1")));
    fireEvent.blur(screen.getByRole("textbox"));
    expect(container.innerHTML).toBe("");
  });

  it("own comments offer delete; others' don't", () => {
    const mine: FileComment = {
      ...existing[0]!,
      id: "c2",
      authorUserId: "u-me",
      authorName: "Tyler",
      body: "my note",
    };
    renderThread({ kind: "item", itemId: "i1" }, [existing[0]!, mine]);
    const deletes = screen.getAllByRole("button", {
      name: en.Team.comment_delete,
    });
    expect(deletes).toHaveLength(1);
  });
});
