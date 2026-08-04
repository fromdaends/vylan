import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import type { FileComment } from "@/lib/db/file-comments";

const loadCommentThreadAction = vi.fn();
const addCommentAction = vi.fn();
const deleteCommentAction = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/actions/comments", () => ({
  loadCommentThreadAction: (...a: unknown[]) => loadCommentThreadAction(...a),
  loadCommentCountsAction: vi.fn(async () => ({})),
  addCommentAction: (...a: unknown[]) => addCommentAction(...a),
  deleteCommentAction: (...a: unknown[]) => deleteCommentAction(...a),
}));

import { RowCommentBubble } from "./row-comment-bubble";
import { openCommentComposer } from "./comment-thread";
import { commentKeyForTask } from "./comment-keys";

const KEY = commentKeyForTask("task-a");

function comment(over: Partial<FileComment> = {}): FileComment {
  return {
    id: "c1",
    uploadedFileId: null,
    requestItemId: null,
    engagementTaskId: "task-a",
    clientId: null,
    authorUserId: "u-zach",
    authorName: "Zach",
    body: "Waiting on the T4 summary",
    mentions: [],
    createdAt: "2026-08-01T10:00:00Z",
    ...over,
  };
}

function renderBubble(initialCount = 0) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RowCommentBubble
        target={{ kind: "task", taskId: "task-a" }}
        commentKey={KEY}
        initialCount={initialCount}
        quotedText="2025 T2 supporting documents"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  loadCommentThreadAction.mockReset();
  addCommentAction.mockReset();
  deleteCommentAction.mockReset();
  loadCommentThreadAction.mockResolvedValue({
    comments: [comment()],
    members: [{ id: "u-me", name: "Tyler" }],
    currentUserId: "u-me",
    legacy: false,
  });
});
afterEach(cleanup);

// The founder's actual report: "you can't right click on a task to add a
// comment... the right click should be universal." The reason it never worked
// is the thing these tests pin — a task row had NO mounted thread, so the open
// event had nothing listening. This component is the listener.
describe("RowCommentBubble", () => {
  it("renders nothing on a row with no comments, until asked", () => {
    const { container } = renderBubble(0);
    expect(container.firstChild).toBeNull();
    // And it never fetched: a clean list costs nothing.
    expect(loadCommentThreadAction).not.toHaveBeenCalled();
  });

  it("shows the count from the table's batched read, WITHOUT fetching", () => {
    renderBubble(3);
    expect(screen.getByText("3")).toBeTruthy();
    // The whole point of handing the count in — forty rows must not be forty
    // requests.
    expect(loadCommentThreadAction).not.toHaveBeenCalled();
  });

  it("opens from the right-click menu's event and loads the thread then", async () => {
    renderBubble(0);
    act(() => openCommentComposer(KEY));
    expect(await screen.findByText("Waiting on the T4 summary")).toBeTruthy();
    expect(loadCommentThreadAction).toHaveBeenCalledWith({
      kind: "task",
      taskId: "task-a",
    });
  });

  it("ignores an open event meant for a DIFFERENT row", async () => {
    renderBubble(0);
    act(() => openCommentComposer(commentKeyForTask("some-other-task")));
    await waitFor(() => expect(loadCommentThreadAction).not.toHaveBeenCalled());
    expect(screen.queryByText("Waiting on the T4 summary")).toBeNull();
  });

  it("posts through the unified action", async () => {
    addCommentAction.mockResolvedValue({
      ok: true,
      comment: comment({ id: "c2", body: "Chased them", authorUserId: "u-me", authorName: "Tyler" }),
    });
    renderBubble(1);
    act(() => openCommentComposer(KEY));
    const box = await screen.findByPlaceholderText(
      en.Team.comment_placeholder_short,
    );
    fireEvent.change(box, { target: { value: "Chased them" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(addCommentAction).toHaveBeenCalled());
    expect(addCommentAction.mock.calls[0][0]).toMatchObject({
      target: { kind: "task", taskId: "task-a" },
      body: "Chased them",
    });
  });

  it("does not let a click on the bubble also open the row's panel", () => {
    const onRowClick = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        {/* The row itself is clickable on both tables this sits in. */}
        <div onClick={onRowClick}>
          <RowCommentBubble
            target={{ kind: "task", taskId: "task-a" }}
            commentKey={KEY}
            initialCount={2}
          />
        </div>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByText("2"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
