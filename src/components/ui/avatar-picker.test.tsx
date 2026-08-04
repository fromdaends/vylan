import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AvatarPicker } from "./avatar-picker";

const LABELS = {
  change: "Change picture",
  uploading: "Uploading…",
  remove: "Remove",
  error: () => "Could not save that picture.",
};

function setup(over: Partial<Parameters<typeof AvatarPicker>[0]> = {}) {
  // Typed with the real prop signature: a bare `vi.fn(async () => …)` infers a
  // zero-length argument tuple, so reading .mock.calls[0][0] fails tsc — which
  // `next build` does NOT check, only `tsc --noEmit` does.
  const onUpload = vi.fn<(fd: FormData) => Promise<{ ok: boolean; signedUrl?: string | null }>>(
    async () => ({ ok: true, signedUrl: "https://x/new.jpg" }),
  );
  const onRemove = vi.fn(async () => ({ ok: true }));
  render(
    <AvatarPicker
      name="ABC Incorporation Inc"
      onUpload={onUpload}
      onRemove={onRemove}
      labels={LABELS}
      {...over}
    />,
  );
  return { onUpload, onRemove };
}

function pickFile() {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

afterEach(cleanup);

// One picker, two surfaces (your own profile and a client's edit form). These
// tests pin the behaviour that must not drift between them — the reason the
// component was extracted rather than copied.
describe("AvatarPicker", () => {
  it("falls back to initials when there is no picture", () => {
    setup();
    // No <img>, and the initials the name computes to.
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("shows the existing picture when one is passed", () => {
    setup({ currentUrl: "https://x/current.jpg" });
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("current.jpg");
  });

  it("offers Remove only once there is something to remove", () => {
    setup();
    expect(screen.queryByText(LABELS.remove)).toBeNull();
    cleanup();
    setup({ currentUrl: "https://x/current.jpg" });
    expect(screen.getByText(LABELS.remove)).toBeTruthy();
  });

  it("uploads the chosen file and swaps in the returned picture", async () => {
    const { onUpload } = setup();
    pickFile();
    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    const fd = onUpload.mock.calls[0][0];
    expect(fd.get("file")).toBeInstanceOf(File);
    await waitFor(() => {
      const img = document.querySelector("img") as HTMLImageElement | null;
      expect(img?.getAttribute("src")).toContain("new.jpg");
    });
  });

  it("clears the input so re-picking the SAME file still fires", async () => {
    const { onUpload } = setup();
    const input = pickFile();
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    // The browser only fires `change` when the value differs; without the
    // reset, retrying the identical file after a failure would do nothing.
    expect(input.value).toBe("");
  });

  it("surfaces an error and keeps the old picture when the upload fails", async () => {
    const onUpload = vi.fn(async () => ({ ok: false }));
    render(
      <AvatarPicker
        name="ABC Incorporation Inc"
        currentUrl="https://x/current.jpg"
        onUpload={onUpload}
        onRemove={vi.fn(async () => ({ ok: true }))}
        labels={LABELS}
      />,
    );
    pickFile();
    expect(await screen.findByText("Could not save that picture.")).toBeTruthy();
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("current.jpg");
  });

  it("removes the picture and goes back to initials", async () => {
    const { onRemove } = setup({ currentUrl: "https://x/current.jpg" });
    fireEvent.click(screen.getByText(LABELS.remove));
    await waitFor(() => expect(onRemove).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector("img")).toBeNull());
  });
});
