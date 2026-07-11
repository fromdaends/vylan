import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Breadcrumb } from "./breadcrumb";

afterEach(cleanup);

describe("Breadcrumb", () => {
  it("renders no path navigation anywhere in the app", () => {
    const { container } = render(
      <Breadcrumb
        label="Breadcrumb"
        items={[
          { label: "Engagements", href: "/engagements" },
          { label: "Active", href: "/engagements" },
          { label: "Year-End 2025" },
        ]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
