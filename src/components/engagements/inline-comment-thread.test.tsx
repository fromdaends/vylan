import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import type { FileComment } from "@/lib/db/file-comments";

const loadCommentThreadAction = vi.fn();
const addCommentAction = vi.fn();
const deleteCommentAction = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/actions/comments", () => ({
  loadCommentThreadAction: (...a: unknown[]) => loadCommentThreadAction(...a),
  addCommentAction: (...a: unknown[]) => addCommentAction(...a),
  deleteCommentAction: (...a: unknown[]) => deleteCommentAction(...a),
}));

import { InlineCommentThread } from "./inline-comment-thread";

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

const MEMBERS = [
  { id: "u-me", name: "Tyler" },
  { id: "u-zach", name: "Zach" },
];

function renderThread(target: Parameters<typeof InlineCommentThread>[0]["target"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InlineCommentThread target={target} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  loadCommentThreadAction.mockReset();
  addCommentAction.mockReset();
  deleteCommentAction.mockReset();
  loadCommentThreadAction.mockResolvedValue({
    comments: [comment()],
    members: MEMBERS,
    currentUserId: "u-me",
    legacy: false,
  });
});
afterEach(cleanup);

// The whole point of this component: it is handed a TARGET and nothing else.
// Every other comment surface in the app is fed its rows by a Server Component,
// which is why commenting could only ever appear where a page had been edited
// to thread the data down. This one can be dropped anywhere.
describe("InlineCommentThread — self-loading", () => {
  it("fetches its own rows for the target it was given", async () => {
    renderThread({ kind: "task", taskId: "task-a" });
    expect(await screen.findByText("Waiting on the T4 summary")).toBeTruthy();
    expect(loadCommentThreadAction).toHaveBeenCalledWith({
      kind: "task",
      taskId: "task-a",
    });
  });

  it("shows the empty line rather than a bare box when there is nothing yet", async () => {
    loadCommentThreadAction.mockResolvedValue({
      comments: [],
      members: MEMBERS,
      currentUserId: "u-me",
      legacy: false,
    });
    renderThread({ kind: "client", clientId: "cl-1" });
    expect(await screen.findByText(en.Team.comment_empty)).toBeTruthy();
  });

  it("posts through the unified action and shows the new comment", async () => {
    addCommentAction.mockResolvedValue({
      ok: true,
      comment: comment({ id: "c2", body: "Chased them today", authorUserId: "u-me", authorName: "Tyler" }),
    });
    renderThread({ kind: "task", taskId: "task-a" });
    const box = await screen.findByPlaceholderText(en.Team.comment_placeholder_short);

    fireEvent.change(box, { target: { value: "Chased them today" } });
    // Enter posts — the convention every other comment box in the app uses.
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(addCommentAction).toHaveBeenCalled());
    expect(addCommentAction.mock.calls[0][0]).toMatchObject({
      target: { kind: "task", taskId: "task-a" },
      body: "Chased them today",
    });
    expect(await screen.findByText("Chased them today")).toBeTruthy();
  });

  it("does not post an empty body", async () => {
    renderThread({ kind: "task", taskId: "task-a" });
    const box = await screen.findByPlaceholderText(en.Team.comment_placeholder_short);
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(addCommentAction).not.toHaveBeenCalled();
  });
});

// A client's notes still live in client_notes until 1510 is applied. They must
// still READ and WRITE in that state — an empty box where a firm's notes used to
// be is the worst possible way to ship this — but a legacy note has nowhere to
// store a mention, so the @ control is hidden rather than silently dropping it.
describe("InlineCommentThread — pre-migration client notes", () => {
  it("renders the old notes and hides the mention control", async () => {
    loadCommentThreadAction.mockResolvedValue({
      comments: [
        comment({
          id: "note:n1",
          engagementTaskId: null,
          clientId: "cl-1",
          body: "Do not email info@, nobody reads it",
        }),
      ],
      members: MEMBERS,
      currentUserId: "u-me",
      legacy: true,
    });
    renderThread({ kind: "client", clientId: "cl-1" });

    expect(
      await screen.findByText("Do not email info@, nobody reads it"),
    ).toBeTruthy();
    expect(screen.queryByLabelText(en.Team.mention_insert)).toBeNull();
  });

  it("still offers the mention control once the migration has landed", async () => {
    renderThread({ kind: "client", clientId: "cl-1" });
    expect(await screen.findByLabelText(en.Team.mention_insert)).toBeTruthy();
  });
});
