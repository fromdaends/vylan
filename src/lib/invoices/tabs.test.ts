import { describe, it, expect } from "vitest";
import {
  resolveInvoiceFilters,
  billingHref,
  hasAnyFilter,
} from "./tabs";

describe("resolveInvoiceFilters", () => {
  it("defaults to everything, page 1", () => {
    expect(resolveInvoiceFilters({})).toEqual({
      status: "all",
      clientId: null,
      from: null,
      to: null,
      search: null,
      page: 1,
    });
  });

  it("reads each filter", () => {
    const f = resolveInvoiceFilters({
      status: "overdue",
      client: "abc",
      from: "2026-01-01",
      to: "2026-03-31",
      q: " INV-0007 ",
      page: "3",
    });
    expect(f).toEqual({
      status: "overdue",
      clientId: "abc",
      from: "2026-01-01",
      to: "2026-03-31",
      search: "INV-0007",
      page: 3,
    });
  });

  it("ignores a status it does not recognise", () => {
    expect(resolveInvoiceFilters({ status: "drop table" }).status).toBe("all");
  });

  // A malformed date reaching the query would be a PostgREST error, not an
  // empty list — so anything that is not an ISO day is simply not a filter.
  it("drops dates that are not ISO days", () => {
    const f = resolveInvoiceFilters({ from: "01/02/2026", to: "yesterday" });
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });

  it("swaps a backwards range rather than returning nothing", () => {
    const f = resolveInvoiceFilters({ from: "2026-06-01", to: "2026-01-01" });
    expect(f.from).toBe("2026-01-01");
    expect(f.to).toBe("2026-06-01");
  });

  it("refuses a zero or negative page", () => {
    expect(resolveInvoiceFilters({ page: "0" }).page).toBe(1);
    expect(resolveInvoiceFilters({ page: "-4" }).page).toBe(1);
    expect(resolveInvoiceFilters({ page: "abc" }).page).toBe(1);
  });
});

describe("billingHref", () => {
  const BASE = resolveInvoiceFilters({});

  it("is the bare path with no filters", () => {
    expect(billingHref(BASE)).toBe("/billing");
  });

  it("keeps the other filters when one changes", () => {
    const f = resolveInvoiceFilters({ client: "abc", status: "overdue" });
    expect(billingHref(f, { status: "paid" })).toBe(
      "/billing?status=paid&client=abc",
    );
  });

  // Staying on page 4 of a narrower result set is how you land on an empty
  // list and conclude the filter is broken.
  it("resets to page 1 when a filter changes", () => {
    const f = resolveInvoiceFilters({ page: "4", client: "abc" });
    expect(billingHref(f, { status: "paid" })).not.toContain("page=");
  });

  it("keeps the page when only paginating", () => {
    const f = resolveInvoiceFilters({ client: "abc", page: "2" });
    expect(billingHref(f, { page: 3 })).toBe("/billing?client=abc&page=3");
  });

  it("omits page=1", () => {
    const f = resolveInvoiceFilters({ page: "2" });
    expect(billingHref(f, { page: 1 })).toBe("/billing");
  });

});

describe("hasAnyFilter", () => {
  it("is false for the default view", () => {
    expect(hasAnyFilter(resolveInvoiceFilters({}))).toBe(false);
  });

  // Page is not a filter: being on page 2 must not offer "clear filters".
  it("is false on page 2 with nothing filtered", () => {
    expect(hasAnyFilter(resolveInvoiceFilters({ page: "2" }))).toBe(false);
  });

  it("is true once anything is filtered", () => {
    expect(hasAnyFilter(resolveInvoiceFilters({ status: "paid" }))).toBe(true);
    expect(hasAnyFilter(resolveInvoiceFilters({ q: "acme" }))).toBe(true);
  });
});
