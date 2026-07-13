import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PostDraftControls } from "./post-draft-controls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = {
  fileId: "f1",
  direction: "expense" as const,
  postedAtLabel: null as string | null,
  postedByName: null as string | null,
  postError: null as string | null,
  locale: "en" as const,
};

function renderControls(
  props: Partial<React.ComponentProps<typeof PostDraftControls>>,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PostDraftControls status="approved" {...base} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PostDraftControls — post clarity", () => {
  it("explains the create-or-attach outcome in the Post confirm dialog", async () => {
    renderControls({ status: "approved", direction: "expense" });
    fireEvent.click(
      screen.getByRole("button", { name: /Post to QuickBooks/ }),
    );
    await waitFor(() =>
      expect(screen.getByText(en.Quickbooks.post_match_hint)).toBeTruthy(),
    );
  });

  it("labels a freshly-CREATED post as created in QuickBooks", () => {
    renderControls({
      status: "posted",
      matchedExisting: false,
      postedByName: "Tyler",
      postedAtLabel: "Jul 13",
      receiptAttached: true,
    });
    expect(screen.getByText(/Created in QuickBooks by Tyler/)).toBeTruthy();
    // No "nothing new created" wording on a real create.
    expect(screen.queryByText(/nothing new created/)).toBeNull();
  });

  it("labels a MATCHED post as attached to an existing entry, with Unlink", () => {
    renderControls({
      status: "posted",
      matchedExisting: true,
      postedAtLabel: "Jul 13",
      receiptAttached: true,
    });
    expect(screen.getByText(/nothing new created/)).toBeTruthy();
    // The undo control becomes "Unlink" (nothing is deleted in QuickBooks).
    expect(
      screen.getByRole("button", { name: en.Quickbooks.unlink_button }),
    ).toBeTruthy();
  });
});
