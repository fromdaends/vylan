import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FooterLangSwitch, FooterDemoLink } from "./vylan-footer-client";

const pushMock = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    locale,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    locale?: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} data-locale={locale} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/help/getting-started",
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

beforeEach(() => {
  pushMock.mockReset();
  document.body.innerHTML = "";
});

describe("FooterLangSwitch", () => {
  it("switches locale on the CURRENT page, not back to home", () => {
    render(<FooterLangSwitch label="Language" />);
    const en = screen.getByText("English");
    const fr = screen.getByText("Français");
    // Both point at the page the reader is on; only the locale differs.
    expect(en).toHaveAttribute("href", "/help/getting-started");
    expect(fr).toHaveAttribute("href", "/help/getting-started");
    expect(en).toHaveAttribute("data-locale", "en");
    expect(fr).toHaveAttribute("data-locale", "fr");
  });

  it("lights up the active locale", () => {
    render(<FooterLangSwitch label="Language" />);
    expect(screen.getByText("English")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Français")).toHaveAttribute(
      "aria-current",
      "false",
    );
  });
});

describe("FooterDemoLink", () => {
  it("smooth-scrolls in place when the lead form is on the page", () => {
    const form = document.createElement("section");
    form.id = "vy-get-access";
    form.scrollIntoView = vi.fn();
    document.body.appendChild(form);

    render(<FooterDemoLink label="Book a demo" />);
    fireEvent.click(screen.getByText("Book a demo"));

    expect(form.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to the landing form when the page has no form (help, legal)", () => {
    render(<FooterDemoLink label="Book a demo" />);
    fireEvent.click(screen.getByText("Book a demo"));
    expect(pushMock).toHaveBeenCalledWith("/#vy-get-access");
  });
});
