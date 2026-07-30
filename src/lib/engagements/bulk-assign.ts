// How many engagements one bulk assign may move.
//
// Karbon caps their equivalent at 100. This is deliberately lower: every moved
// engagement writes its own activity row AND its own "assigned to you"
// notification, so 100 would mean a hundred notifications landing on one person
// at once. 25 covers the case this exists for — "Clarence is off for two weeks,
// move his active files to Marc" — without turning into a mailbomb. The action
// REFUSES past the cap rather than silently truncating: a bulk action that
// quietly does less than you asked is the worst kind.
//
// Lives here, not in app/actions/engagements.ts, because that file is
// "use server" and such a module may export ASYNC FUNCTIONS ONLY. Exporting a
// plain const from it typechecks and lints clean and then fails the production
// build — a trap this repo has now hit twice.
export const BULK_ASSIGN_MAX = 25;
