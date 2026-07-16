import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VylanMenu, type VylanMenuStrings } from "./vylan-menu";

// next-intl's navigation reads routing config + the router at import time;
// none of that is what these tests are about.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/help",
}));

const S: VylanMenuStrings = {
  brand: "vylan",
  logoAlt: "Vylan",
  menuLabel: "Open menu",
  closeLabel: "Close menu",
  defTerm: "vylan",
  defAbbr: "n.",
  defText: "definition",
  navHome: "HOME",
  navHowItWorks: "HOW IT WORKS",
  navBookDemo: "BOOK A DEMO",
  navLogin: "LOGIN",
  navContact: "CONTACT",
  navHelp: "HELP",
  follow: "Follow",
};

function scrollTo(y: number) {
  // happy-dom doesn't scroll, so set the value the handler reads and fire the
  // event the listener is bound to.
  act(() => {
    Object.defineProperty(window, "scrollY", {
      value: y,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  Object.defineProperty(window, "scrollY", {
    value: 0,
    writable: true,
    configurable: true,
  });
});

const brand = () => screen.getByRole("button", { name: "Open menu" });

describe("brand scroll-away (hideBrandOnScroll)", () => {
  it("is off by default, so the landing and how-it-works are untouched", () => {
    render(<VylanMenu s={S} />);
    expect(brand().className).toBe("vy-brand");
    scrollTo(900);
    // No listener should have been attached at all.
    expect(brand().className).toBe("vy-brand");
  });

  it("hides the brand once you have scrolled in", () => {
    render(<VylanMenu s={S} hideBrandOnScroll />);
    expect(brand().className).not.toContain("vy-brand-hidden");
    scrollTo(200);
    expect(brand().className).toContain("vy-brand-hidden");
  });

  it("brings it back at the top of the page", () => {
    render(<VylanMenu s={S} hideBrandOnScroll />);
    scrollTo(200);
    expect(brand().className).toContain("vy-brand-hidden");
    scrollTo(0);
    expect(brand().className).not.toContain("vy-brand-hidden");
  });

  it("does not hide on a nudge of the wheel", () => {
    render(<VylanMenu s={S} hideBrandOnScroll />);
    scrollTo(40);
    expect(brand().className).not.toContain("vy-brand-hidden");
  });

  it("reads the scroll position on mount, not just on the next scroll", () => {
    // A reload restores scroll position. The brand must not flash in at
    // whatever height the browser drops you back at.
    Object.defineProperty(window, "scrollY", {
      value: 800,
      writable: true,
      configurable: true,
    });
    render(<VylanMenu s={S} hideBrandOnScroll />);
    expect(brand().className).toContain("vy-brand-hidden");
  });

  it("closes an open menu when the brand hides", () => {
    render(<VylanMenu s={S} hideBrandOnScroll />);
    fireEvent.click(brand());
    expect(brand()).toHaveAttribute("aria-expanded", "true");
    scrollTo(300);
    // An open menu whose trigger just faded out is one you can't dismiss by
    // leaving it.
    expect(brand()).toHaveAttribute("aria-expanded", "false");
  });

  it("removes the listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<VylanMenu s={S} hideBrandOnScroll />);
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    remove.mockRestore();
  });
});

describe("book-a-demo target", () => {
  it("defaults to the in-page lead-form anchor", () => {
    render(<VylanMenu s={S} />);
    expect(screen.getByText("BOOK A DEMO").closest("a")).toHaveAttribute(
      "href",
      "#vy-get-access",
    );
  });

  it("navigates away instead when the page has no lead form", () => {
    render(<VylanMenu s={S} bookDemoHref="/fr/#vy-get-access" />);
    expect(screen.getByText("BOOK A DEMO").closest("a")).toHaveAttribute(
      "href",
      "/fr/#vy-get-access",
    );
  });
});

describe("help link", () => {
  it("is absent unless a href is given", () => {
    render(<VylanMenu s={S} />);
    expect(screen.queryByText("HELP")).toBeNull();
  });

  it("opens in a new tab, safely", () => {
    render(<VylanMenu s={S} helpHref="/help" />);
    const a = screen.getByText("HELP").closest("a")!;
    expect(a).toHaveAttribute("href", "/help");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });
});
