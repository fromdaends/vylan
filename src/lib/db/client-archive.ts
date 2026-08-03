// What remains of the retired per-client archive PAGE's data layer.
//
// The archive view (client-archive-view.tsx), its filter lib, the
// per-engagement ZIP route and the per-file byte route were deleted when the
// client's Files tab became the one home for files — see the redirect note in
// app/[locale]/(app)/clients/[id]/archive/page.tsx. The whole-client
// "Download everything" ZIP survives on the Files tab, and its layout builder
// (lib/archive/download.ts) still keys folders off this category union.
export type ArchiveCategoryKey = "checklist" | "signed" | "final";
