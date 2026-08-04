import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BackLink } from "./back-link";

afterEach(cleanup);

describe("BackLink", () => {
  it("names its destination in the row shape", () => {
    render(<BackLink href="/clients" label="All clients" />);
    const link = screen.getByRole("link", { name: "All clients" });
    expect(link.getAttribute("href")).toBe("/clients");
  });

  // ⚠️ THIS IS THE ONE THAT MATTERS. The inline shape is an ICON ONLY — there
  // is no text in it — so without aria-label a screen reader announces it as
  // an unnamed link. Deleting `aria-label` from back-link.tsx must turn this
  // red; it was watched doing exactly that before being trusted (the last
  // session shipped a guard that passed with its fix deleted, because it
  // asserted a string that also appeared in a nearby comment).
  it("still announces a destination when it is an icon with no text", () => {
    render(
      <BackLink href="/engagements/drafts" label="Back to Drafts" variant="inline" />,
    );
    const link = screen.getByRole("link", { name: "Back to Drafts" });
    expect(link.getAttribute("href")).toBe("/engagements/drafts");
    // The name can only be coming from the label — the element renders no
    // text of its own. If someone "simplifies" this to an unlabelled arrow,
    // the query above fails rather than this passing on the arrow's markup.
    expect(link.textContent?.trim()).toBe("");
  });

  it("keeps the destination discoverable with a mouse too", () => {
    render(<BackLink href="/engagements" label="Back to Active" variant="inline" />);
    expect(
      screen.getByRole("link", { name: "Back to Active" }).getAttribute("title"),
    ).toBe("Back to Active");
  });
});
