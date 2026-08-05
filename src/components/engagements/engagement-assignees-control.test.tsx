import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const addEngagementAssigneeAction = vi.fn();
const removeEngagementAssigneeAction = vi.fn();
const refresh = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/engagement-assignees", () => ({
  addEngagementAssigneeAction: (...a: unknown[]) =>
    addEngagementAssigneeAction(...a),
  removeEngagementAssigneeAction: (...a: unknown[]) =>
    removeEngagementAssigneeAction(...a),
}));

import { EngagementAssigneesControl } from "./engagement-assignees-control";

const MEMBERS = [
  { id: "u-tyler", name: "Tyler Jette" },
  { id: "u-zach", name: "Zachary Thresh" },
];

function renderControl(assigneeIds = ["u-tyler"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementAssigneesControl
        engagementId="e-1"
        assigneeIds={assigneeIds}
        primaryId="u-tyler"
        members={MEMBERS}
        canEdit
      />
    </NextIntlClientProvider>,
  );
}

/** Open the "+" popover and tick a teammate. */
function toggle(name: string) {
  fireEvent.click(screen.getByLabelText(en.Engagements.assignee_add));
  fireEvent.click(screen.getByText(name));
}

/** The AVATAR ROW only. The "+" popover stays open after a toggle and lists
 *  every member by name, so an unscoped query would always "find" the person
 *  whether or not their face is actually on the card. */
const facesFor = () =>
  screen
    .getAllByTitle(/./)
    .filter((el) => !el.closest('[role="group"]'))
    .map((el) => el.getAttribute("title") ?? "");

beforeEach(() => {
  addEngagementAssigneeAction.mockReset();
  removeEngagementAssigneeAction.mockReset();
  refresh.mockReset();
  addEngagementAssigneeAction.mockResolvedValue({ ok: true });
  removeEngagementAssigneeAction.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

// ── THE REGRESSION THAT GOT THIS CONTROL UNWIRED ────────────────────────────
//
// The previous session's note blamed the click path ("the popover trigger
// measures 0x0") and proved the WRITE was fine by running the upsert against
// production with the service role. Both were dead ends — service role bypasses
// RLS, and this table's writer bypasses it by design anyway.
//
// The real fault: on success the control called setOptimistic(null), which
// means "render the PROP again" — and the prop is still the pre-add list until
// router.refresh() lands new props. The face appeared and then VANISHED, which
// reads exactly like a silent failure even though the row was written.
//
// These tests never re-render with new props, so a control that hands back to
// the server too early fails them — which is precisely the bug.
describe("EngagementAssigneesControl — the added face must not vanish", () => {
  it("keeps the new person on screen after the server accepts", async () => {
    renderControl(["u-tyler"]);
    toggle("Zachary Thresh");

    await waitFor(() => expect(addEngagementAssigneeAction).toHaveBeenCalled());
    expect(addEngagementAssigneeAction.mock.calls[0][0]).toMatchObject({
      engagementId: "e-1",
      userId: "u-zach",
    });

    // Props never change here. The face has to still be there.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(facesFor().some((f) => f.startsWith("Zachary Thresh"))).toBe(true);
  });

  it("takes the face away again when the server refuses", async () => {
    addEngagementAssigneeAction.mockResolvedValue({ ok: false });
    renderControl(["u-tyler"]);
    toggle("Zachary Thresh");
    await waitFor(() => expect(addEngagementAssigneeAction).toHaveBeenCalled());
    await waitFor(() =>
      expect(facesFor().some((f) => f.startsWith("Zachary Thresh"))).toBe(false),
    );
  });

  it("removes optimistically too, and puts them back on refusal", async () => {
    removeEngagementAssigneeAction.mockResolvedValue({ ok: false });
    renderControl(["u-tyler", "u-zach"]);
    toggle("Zachary Thresh");
    await waitFor(() =>
      expect(removeEngagementAssigneeAction).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(facesFor().some((f) => f.startsWith("Zachary Thresh"))).toBe(true),
    );
  });

  it("hands control back once the SERVER's own list actually arrives", async () => {
    const { rerender } = renderControl(["u-tyler"]);
    toggle("Zachary Thresh");
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    // The refresh lands, carrying the row the server really has.
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <EngagementAssigneesControl
          engagementId="e-1"
          assigneeIds={["u-tyler", "u-zach"]}
          primaryId="u-tyler"
          members={MEMBERS}
          canEdit
        />
      </NextIntlClientProvider>,
    );
    expect(facesFor().some((f) => f.startsWith("Zachary Thresh"))).toBe(true);
  });
});
