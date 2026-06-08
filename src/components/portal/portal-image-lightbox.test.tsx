import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PortalImageLightbox, type LightboxItem } from "./portal-image-lightbox";
import en from "../../../messages/en.json";

// A magic token is 43 url-safe chars; the lightbox only uses it to build the
// per-file URLs, so any well-formed value is fine for these DOM tests.
const TOKEN = "a".repeat(43);
const ITEMS: LightboxItem[] = [
  { id: "f1", name: "first.jpg", kind: "image" },
  { id: "f2", name: "second.jpg", kind: "image" },
];

function renderLightbox(index = 0) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PortalImageLightbox
        token={TOKEN}
        items={ITEMS}
        index={index}
        onClose={onClose}
        onIndexChange={onIndexChange}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onClose, onIndexChange };
}

describe("PortalImageLightbox", () => {
  it("renders the viewer through a portal on <body>, not inside the row it was mounted from", () => {
    // This is the whole fix for the "opens inside the row / frozen" bug: the
    // overlay MUST be lifted to <body>. Rendered inline, a checklist row's
    // lingering entrance transform makes the row a containing block and traps
    // this `fixed` overlay inside it. `container` is the component's inline
    // mount point; a portaled dialog lands on <body>, outside it.
    const { container } = renderLightbox();
    const dialog = screen.getByRole("dialog");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  it("shows only the current document at a time (never all of an item's files at once)", () => {
    renderLightbox();
    expect(screen.getByText("first.jpg")).toBeInTheDocument();
    expect(screen.queryByText("second.jpg")).not.toBeInTheDocument();
  });

  it("closes from the close button and steps with prev / next", () => {
    const { onClose, onIndexChange } = renderLightbox(0);
    fireEvent.click(
      screen.getByRole("button", { name: en.Portal.preview_close }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: en.Portal.preview_next }),
    );
    expect(onIndexChange).toHaveBeenCalledWith(1);

    // Prev from the first item wraps to the last (2 items -> index 1).
    fireEvent.click(
      screen.getByRole("button", { name: en.Portal.preview_prev }),
    );
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("locks background scroll while open and restores it on close", () => {
    const { unmount } = renderLightbox();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
