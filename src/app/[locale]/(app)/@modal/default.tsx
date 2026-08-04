// Nothing in the modal slot unless an intercepting route matched.
//
// Required by Next: without a default, a hard navigation to any non-modal route
// leaves the slot unresolved and the whole layout 404s.
export default function ModalSlotDefault() {
  return null;
}
