import { EngagementsListSkeleton } from "@/components/engagements/engagements-list-skeleton";

// All-Engagements list skeleton — shown instantly on a cold navigation to any
// Engagements sub-page (this segment's Suspense fallback), so switching tabs
// never sits on a frozen page while the rows load. Warm revisits (the 30s
// router cache) skip this entirely and paint instantly.
//
// The SHAPE lives in the component, shared with the backdrop behind Create
// Engagement, so the two cannot drift into different versions of one list.
export default function Loading() {
  return <EngagementsListSkeleton />;
}
