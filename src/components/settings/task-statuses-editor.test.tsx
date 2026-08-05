import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const createStatusAction = vi.fn();
const updateStatusAction = vi.fn();
const deleteStatusAction = vi.fn();
const moveStatusAction = vi.fn();
const refresh = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/task-statuses", () => ({
  createStatusAction: (...a: unknown[]) => createStatusAction(...a),
  updateStatusAction: (...a: unknown[]) => updateStatusAction(...a),
  deleteStatusAction: (...a: unknown[]) => deleteStatusAction(...a),
  moveStatusAction: (...a: unknown[]) => moveStatusAction(...a),
}));

import { TaskStatusesEditor, type EditableStatus } from "./task-statuses-editor";

const STATUSES: EditableStatus[] = [
  { id: "s1", name: "To do", color: "#2563eb", bucket: "todo", isBuiltin: true },
  {
    id: "s2",
    name: "In progress",
    color: "#dc2626",
    bucket: "doing",
    isBuiltin: true,
  },
  { id: "s3", name: "Done", color: "#16a34a", bucket: "done", isBuiltin: true },
];

function renderEditor(statuses = STATUSES, canEdit = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TaskStatusesEditor statuses={statuses} canEdit={canEdit} />
    </NextIntlClientProvider>,
  );
}

const dotOf = (name: string) => {
  const input = screen.getByDisplayValue(name);
  const li = input.closest("li")!;
  // The row's preview pill wraps the coloured dot, and the dot inherits
  // aria-hidden rather than carrying it — so look for the first span that
  // actually has a background colour rather than relying on where it sits.
  // Written this way so the markup can keep improving without the assertion
  // going hunting. (The swatch picker's colours are on <button>, not <span>.)
  return (
    [...li.querySelectorAll<HTMLElement>("span")]
      .map((el) => el.style.backgroundColor)
      .find(Boolean) ?? ""
  );
};

beforeEach(() => {
  createStatusAction.mockReset();
  updateStatusAction.mockReset();
  deleteStatusAction.mockReset();
  refresh.mockReset();
  updateStatusAction.mockResolvedValue({ ok: true });
  deleteStatusAction.mockResolvedValue({ ok: true });
  moveStatusAction.mockReset();
  moveStatusAction.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

// ── THE REGRESSION ──────────────────────────────────────────────────────────
//
// The founder: "its fully bugged". Every write actually SUCCEEDED — the colour
// was in the database the whole time. Nothing on screen ever moved, because the
// list only redrew when router.refresh() brought new props back. You click a
// colour, the page sits there, you click again, it sits there, and you conclude
// it is dead. It took a manual reload to see any of it.
//
// These tests render with FIXED props and never re-render them, so a change
// that is only visible after a refresh fails here — which is precisely the bug.
describe("TaskStatusesEditor — a change shows without waiting for a refresh", () => {
  it("recolours the row as soon as the server accepts, props unchanged", async () => {
    renderEditor();
    expect(dotOf("To do")).toBe("#2563eb");

    fireEvent.click(screen.getAllByLabelText("Use #7c3aed")[0]);

    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    expect(updateStatusAction.mock.calls[0][0]).toMatchObject({
      id: "s1",
      color: "#7c3aed",
    });
    // The row itself, not a refetch.
    await waitFor(() => expect(dotOf("To do")).toBe("#7c3aed"));
  });

  it("keeps the old colour when the server refuses", async () => {
    updateStatusAction.mockResolvedValue({ ok: false, error: "failed" });
    renderEditor();
    fireEvent.click(screen.getAllByLabelText("Use #7c3aed")[0]);
    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    expect(dotOf("To do")).toBe("#2563eb");
  });

  it("does NOT refetch the page for a recolour", async () => {
    // This asserted the opposite until the founder said "There was still a lot
    // of latency on the statuses page. Like, bro, come on. It should be
    // seamless."
    //
    // router.refresh() re-renders the Server Component route — three database
    // reads — and hands the client a brand-new array. Firing it per accepted
    // write meant a seven-letter rename fired seven, each racing the next and
    // each re-seeding the list under the cursor. A recolour is patched locally
    // and correctly, so re-reading the server tells nobody anything.
    renderEditor();
    fireEvent.click(screen.getAllByLabelText("Use #7c3aed")[0]);
    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("paints the new colour BEFORE the server answers", async () => {
    // The heart of the complaint. The old code awaited the round trip and only
    // then patched the row, with the whole row disabled meanwhile.
    let release: (v: unknown) => void = () => {};
    updateStatusAction.mockImplementation(
      () => new Promise((r) => { release = r; }),
    );
    renderEditor();
    fireEvent.click(screen.getAllByLabelText("Use #7c3aed")[0]);
    // Still in flight — nothing has resolved.
    await waitFor(() => expect(dotOf("To do")).toBe("#7c3aed"));
    release({ ok: true });
  });

  it("rolls back when the server action REJECTS, not just when it refuses", async () => {
    // Caught live on production. A server action does not always resolve with
    // { ok: false } — it can reject outright, and the commonest cause in this
    // repo is Vercel deploy skew: a tab from the previous deployment posts an
    // action id the new one has never heard of and gets a 503.
    //
    // With optimistic UI that is worse than "the click did nothing": the new
    // colour is ALREADY on screen and the pip says Saved, so the page
    // confidently shows a value the database never took. Observed exactly
    // once, which was once too many.
    updateStatusAction.mockRejectedValue(new Error("503"));
    renderEditor();
    fireEvent.click(screen.getAllByLabelText("Use #7c3aed")[0]);
    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    await waitFor(() => expect(dotOf("To do")).toBe("#2563eb"));
  });

  it("never disables the name field while a save is in flight", async () => {
    // A field that goes dead under your fingers IS the latency, whether or not
    // the request is fast.
    updateStatusAction.mockImplementation(() => new Promise(() => {}));
    renderEditor();
    fireEvent.click(screen.getAllByLabelText("Use #7c3aed")[0]);
    const field = screen.getAllByLabelText("Name")[0] as HTMLInputElement;
    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    expect(field.disabled).toBe(false);
  });

  it("shows a newly added status immediately", async () => {
    createStatusAction.mockResolvedValue({
      ok: true,
      created: { id: "s4", name: "With client", color: "#0891b2", bucket: "doing" },
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: en.Settings.statuses_add }));
    // The add form's own field — every existing row also has a "Name" label.
    fireEvent.change(
      screen.getByPlaceholderText(en.Settings.statuses_name_placeholder),
      { target: { value: "With client" } },
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: en.Settings.statuses_add }).slice(-1)[0],
    );
    expect(await screen.findByDisplayValue("With client")).toBeTruthy();
  });
});

// ── THE DEAD END ────────────────────────────────────────────────────────────
//
// With one status per stage — the seeded default, and exactly what the founder
// had — the server refuses EVERY delete, because a stage with no statuses is a
// state nothing could ever be set to. The old UI let you open the panel, pick
// where the tasks should go, press the button, and only THEN told you no.
describe("TaskStatusesEditor — deleting", () => {
  it("disables the bin on the last status in a stage, and says why", () => {
    renderEditor();
    // All three are the only one in their stage, so all three bins are dead.
    const bins = screen.getAllByLabelText(en.Settings.statuses_last_in_bucket);
    expect(bins).toHaveLength(3);
    for (const bin of bins) expect((bin as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers the bin once a stage has two, and removes the row on success", async () => {
    renderEditor([
      ...STATUSES,
      { id: "s4", name: "Blocked", color: "#d97706", bucket: "todo" },
    ]);
    const bin = screen.getByLabelText("Delete Blocked");
    expect((bin as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(bin);
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.statuses_delete_confirm }),
    );
    await waitFor(() => expect(deleteStatusAction).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Blocked")).toBeNull(),
    );
  });
});

// ── DESCRIPTION + PRESET (1590) ─────────────────────────────────────────────
//
// Founder's instruction, from Canopy's own help centre: a status carries a
// description, and the ones the product ships are labelled rather than passed
// off as the firm's own work.
describe("TaskStatusesEditor — descriptions and presets", () => {
  it("badges the seeded three, and nothing the firm made itself", () => {
    renderEditor([
      ...STATUSES,
      { id: "s4", name: "With client", color: "#0891b2", bucket: "doing" },
    ]);
    // Three presets, and "With client" is not one of them.
    expect(screen.getAllByText(en.Settings.statuses_preset)).toHaveLength(3);
    const custom = screen.getByDisplayValue("With client").closest("li")!;
    expect(custom.textContent).not.toContain(en.Settings.statuses_preset);
  });

  it("saves a description on blur, and shows it without a refresh", async () => {
    renderEditor();
    const field = screen.getByLabelText("Description for To do");
    fireEvent.change(field, { target: { value: "Nobody has picked it up" } });
    fireEvent.blur(field);

    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    expect(updateStatusAction.mock.calls[0][0]).toMatchObject({
      id: "s1",
      description: "Nobody has picked it up",
    });
  });

  it("clears the description rather than storing an empty string", async () => {
    renderEditor([
      { ...STATUSES[0], description: "Nobody has picked it up" },
      ...STATUSES.slice(1),
    ]);
    const field = screen.getByLabelText("Description for To do");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateStatusAction).toHaveBeenCalled());
    // null, not "" — the reader has one falsy case instead of two.
    expect(updateStatusAction.mock.calls[0][0].description).toBeNull();
  });

  it("does not write when the description has not changed", async () => {
    renderEditor([
      { ...STATUSES[0], description: "Nobody has picked it up" },
      ...STATUSES.slice(1),
    ]);
    const field = screen.getByLabelText("Description for To do");
    fireEvent.blur(field);
    expect(updateStatusAction).not.toHaveBeenCalled();
  });

  it("sends the description when adding a status", async () => {
    createStatusAction.mockResolvedValue({
      ok: true,
      created: {
        id: "s4",
        name: "With client",
        color: "#0891b2",
        bucket: "doing",
        description: "Sent out, waiting on them",
        isBuiltin: false,
      },
    });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: en.Settings.statuses_add }));
    fireEvent.change(
      screen.getByPlaceholderText(en.Settings.statuses_name_placeholder),
      { target: { value: "With client" } },
    );
    fireEvent.change(screen.getByLabelText(en.Settings.statuses_description), {
      target: { value: "Sent out, waiting on them" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: en.Settings.statuses_add }).slice(-1)[0],
    );
    await waitFor(() => expect(createStatusAction).toHaveBeenCalled());
    expect(createStatusAction.mock.calls[0][0]).toMatchObject({
      name: "With client",
      description: "Sent out, waiting on them",
    });
  });
});

// ── THE CANOPY GAP ──────────────────────────────────────────────────────────
//
// Canopy: "Custom statuses display the team member who created them and the
// creation date", and its manager lets a firm "create, edit, delete, and
// reorder". Vylan stored created_by and sort all along and surfaced neither.
describe("TaskStatusesEditor — authorship and order", () => {
  const CUSTOM = {
    id: "s4",
    name: "With client",
    color: "#0891b2",
    bucket: "doing" as const,
    createdByName: "Zachary Thresh",
    createdAt: "2026-07-21T10:00:00.000Z",
  };

  it("names who added a custom status, and when", () => {
    renderEditor([...STATUSES, CUSTOM]);
    expect(screen.getByText(/Added by Zachary Thresh on/)).toBeTruthy();
  });

  it("says nothing about authorship on a preset — nobody in the firm made it", () => {
    renderEditor([{ ...STATUSES[0], createdByName: "Someone", createdAt: "2026-07-21T10:00:00.000Z" }]);
    expect(screen.queryByText(/Added by/)).toBeNull();
    expect(screen.getByText(en.Settings.statuses_preset)).toBeTruthy();
  });

  it("cannot move the first one up or the last one down", () => {
    renderEditor([...STATUSES, CUSTOM]);
    // "In progress" is first in its stage, "With client" last.
    expect(
      (screen.getByLabelText("Move In progress up") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Move With client down") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Move With client up") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("reorders immediately, and puts it back if the server refuses", async () => {
    moveStatusAction.mockResolvedValue({ ok: false, error: "failed" });
    renderEditor([...STATUSES, CUSTOM]);
    const order = () =>
      screen.getAllByLabelText(/^Description for/).map((el) =>
        el.getAttribute("aria-label"),
      );
    const before = order();
    fireEvent.click(screen.getByLabelText("Move With client up"));
    await waitFor(() => expect(moveStatusAction).toHaveBeenCalledWith({
      id: "s4",
      direction: "up",
    }));
    // Snapped back — an order that silently disagrees with the database is
    // worse than one that visibly returns.
    await waitFor(() => expect(order()).toEqual(before));
  });
});
