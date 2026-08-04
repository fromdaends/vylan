// Create engagement, OVERLAID on the page you were already looking at.
//
// The founder: "instead of it just being a white background, it should be an
// overlap and maybe blur the background of what the screen was originally on...
// a box that appears overlapping over the UI that already exists. And keep it
// like that for the entire creation of an engagement, because that's how
// Canopy's is."
//
// That requires the previous page to STILL BE RENDERED, which a normal
// navigation cannot give you — it replaces the page, so there is nothing left
// behind to blur. Next's intercepting routes are the mechanism: an in-app
// navigation to /engagements/new lands HERE, in a parallel slot, while the page
// you came from stays mounted underneath.
//
// A direct load or a refresh does NOT intercept — it falls through to the real
// route, which renders the same screen full-page. That is the correct fallback
// rather than a compromise: on a cold load there is genuinely nothing behind to
// overlay, and a modal floating over a blank page would be worse.

import { NewEngagementScreen } from "@/app/[locale]/(app)/engagements/new/page";

export default async function NewEngagementModal(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client?: string; template?: string }>;
}) {
  return <NewEngagementScreen {...props} overlay />;
}
