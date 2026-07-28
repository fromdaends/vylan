// Comment-thread target keys — a PLAIN module (no "use client") on purpose.
// The engagement page is a Server Component and builds these keys at render
// time; when they lived inside comment-thread.tsx ("use client"), importing
// them there made them client references, and CALLING a client reference on
// the server throws at request time — a 500 invisible to tsc and next build
// (the repo's known RSC function-prop failure class, cf. #796). Keep anything
// a server component needs to CALL out of client modules.

export function commentKeyForFile(fileId: string): string {
  return `file:${fileId}`;
}
export function commentKeyForItem(itemId: string): string {
  return `item:${itemId}`;
}
export function commentKeyForEngagement(engagementId: string): string {
  return `eng:${engagementId}`;
}
