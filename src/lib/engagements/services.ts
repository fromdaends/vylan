import type { EngagementType } from "@/lib/db/templates";

/**
 * The SERVICE an engagement delivers, in the words a firm would use.
 *
 * Canopy's engagement list calls this column "Service items", and the founder
 * asked for it by that name while saying they were not sure how it differed
 * from "Engagement items". The difference is breadth:
 *
 *   • the SERVICE is what you sold — a personal return, the monthly books;
 *   • the ENGAGEMENT ITEMS are the individual pieces of work inside it.
 *
 * Vylan already stores both. The service is the engagement's `type`, and the
 * items are its tasks — so neither needed new storage, only a name. This map is
 * the name, kept in one place so a second surface showing the service cannot
 * quietly invent its own wording.
 *
 * The keys live in the Engagements namespace and are deliberately SHORT.
 * Settings has longer versions of the same three ("Personal return (T1)") for
 * the default-prices form, where a full sentence has room; a table column does
 * not.
 */
export const SERVICE_LABEL_KEY: Record<EngagementType, string> = {
  t1: "wl_service_t1",
  t2: "wl_service_t2",
  bookkeeping: "wl_service_bookkeeping",
  custom: "wl_service_custom",
};

/** Every service, in the order a firm would list them. For filter menus. */
export const SERVICE_TYPES: EngagementType[] = [
  "t1",
  "t2",
  "bookkeeping",
  "custom",
];
