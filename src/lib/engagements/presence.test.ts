import { describe, it, expect } from "vitest";
import {
  presentOthers,
  splitPresence,
  presenceColor,
  groupPresenceByEngagement,
  PRESENCE_COLORS,
  PRESENCE_VISIBLE_MAX,
} from "./presence";

const roster = [
  { id: "u-ash", name: "Ashley" },
  { id: "u-ben", name: "Ben" },
  { id: "u-cam", name: "Cam" },
  { id: "u-dee", name: "Dee" },
  { id: "u-eve", name: "Eve" },
  { id: "u-fin", name: "Fin" },
];

// Supabase hands back key -> array of metas, one per open tab.
const state = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, [{ phx_ref: `ref-${id}` }]]));

describe("presentOthers", () => {
  it("lists everyone else who is here", () => {
    const out = presentOthers(state("u-ash", "u-ben"), "u-ash", roster);
    expect(out).toEqual([{ id: "u-ben", name: "Ben" }]);
  });

  it("never includes the viewer", () => {
    // You are always present in your own channel, so without this the row
    // would never be empty and a solo firm would permanently stare at itself.
    expect(presentOthers(state("u-ash"), "u-ash", roster)).toEqual([]);
  });

  it("DROPS a presence key that is not in the roster", () => {
    // The channel is public: anyone with the publishable key (it ships in the
    // bundle) and an engagement uuid can broadcast any key they like. A
    // presence entry is a claim, not a fact — only the server-rendered roster
    // turns one into a name. This is the single most important rule here.
    const out = presentOthers(
      state("u-ben", "attacker", "u-ash-but-not-really"),
      "u-ash",
      roster,
    );
    expect(out).toEqual([{ id: "u-ben", name: "Ben" }]);
  });

  it("collapses a person's multiple tabs into one avatar", () => {
    // Supabase groups metas under one key, so keying presence by user id gets
    // this for free — asserted so a future switch to a per-tab key is caught.
    const twoTabs = { "u-ben": [{ phx_ref: "a" }, { phx_ref: "b" }] };
    expect(presentOthers(twoTabs, "u-ash", roster)).toEqual([
      { id: "u-ben", name: "Ben" },
    ]);
  });

  it("returns roster order, not arrival order", () => {
    // Otherwise the avatars reshuffle under the cursor whenever someone opens
    // or closes a tab.
    const out = presentOthers(state("u-eve", "u-ben", "u-cam"), "u-ash", roster);
    expect(out.map((p) => p.name)).toEqual(["Ben", "Cam", "Eve"]);
  });

  it("is empty before the first sync and on an empty channel", () => {
    expect(presentOthers(null, "u-ash", roster)).toEqual([]);
    expect(presentOthers(undefined, "u-ash", roster)).toEqual([]);
    expect(presentOthers({}, "u-ash", roster)).toEqual([]);
  });

  it("is empty when the roster is empty", () => {
    expect(presentOthers(state("u-ben"), "u-ash", [])).toEqual([]);
  });
});

describe("splitPresence", () => {
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `P${i}` }));

  it("shows everyone when they fit", () => {
    const out = splitPresence(people(PRESENCE_VISIBLE_MAX));
    expect(out.shown).toHaveLength(PRESENCE_VISIBLE_MAX);
    expect(out.overflow).toBe(0);
  });

  it("never leaves a visible slot empty while the chip says +1", () => {
    // With max=4 and 5 people, showing 4 + "+1" wastes nothing, but showing
    // 3 + "+2" keeps the arithmetic honest as the count grows. Assert the
    // shown count plus the overflow always equals the real total.
    for (const n of [5, 6, 9, 40]) {
      const out = splitPresence(people(n));
      expect(out.shown.length + out.overflow).toBe(n);
      expect(out.shown.length).toBeLessThan(PRESENCE_VISIBLE_MAX);
      expect(out.overflow).toBeGreaterThan(0);
    }
  });

  it("handles nobody", () => {
    expect(splitPresence([])).toEqual({ shown: [], overflow: 0 });
  });
});

describe("presenceColor", () => {
  it("is stable for the same person", () => {
    // A colour that shuffled between reloads would be worse than no colour:
    // the whole point is "the green one is Sarah".
    const id = "8f14e45f-ea28-4c1e-9c0b-6d2f1a3b4c5d";
    expect(presenceColor(id)).toBe(presenceColor(id));
  });

  it("only ever returns a colour from the palette", () => {
    for (const id of ["", "a", "u-ash", "8f14e45f-ea28-4c1e-9c0b-6d2f1a3b4c5d", "ZZZZ"]) {
      expect(PRESENCE_COLORS).toContain(presenceColor(id));
    }
  });

  it("spreads a realistic roster over more than one colour", () => {
    // Not a uniformity guarantee — just that a small firm does not end up
    // with six identical circles, which would defeat the feature.
    const ids = Array.from({ length: 12 }, (_, i) => `user-${i}-abcdef`);
    expect(new Set(ids.map(presenceColor)).size).toBeGreaterThan(1);
  });

  it("leaves rose out — it reads as an error everywhere else in the app", () => {
    expect(PRESENCE_COLORS).not.toContain("icon-rose");
  });
});

describe("groupPresenceByEngagement", () => {
  const on = (id: string, e: string | null) => [{ phx_ref: `r-${id}`, id, e }];

  it("buckets people onto the engagement they have open", () => {
    const out = groupPresenceByEngagement(
      { "u-ben": on("u-ben", "eng-1"), "u-cam": on("u-cam", "eng-2") },
      "u-ash",
      roster,
    );
    expect(out.get("eng-1")?.map((p) => p.name)).toEqual(["Ben"]);
    expect(out.get("eng-2")?.map((p) => p.name)).toEqual(["Cam"]);
  });

  it("leaves out people who are not on any engagement", () => {
    // Everyone on the firm channel is "present" — only the ones with an
    // engagement id belong on a row.
    const out = groupPresenceByEngagement(
      { "u-ben": on("u-ben", null), "u-cam": on("u-cam", "eng-2") },
      "u-ash",
      roster,
    );
    expect(out.has("eng-1")).toBe(false);
    expect([...out.keys()]).toEqual(["eng-2"]);
  });

  it("never buckets the viewer", () => {
    const out = groupPresenceByEngagement(
      { "u-ash": on("u-ash", "eng-1") },
      "u-ash",
      roster,
    );
    expect(out.size).toBe(0);
  });

  it("DROPS a key that is not in the roster", () => {
    // The channel is public and firm-wide now, so an injected key would land on
    // a real row if this filter ever went away. Same rule as presentOthers.
    const out = groupPresenceByEngagement(
      { attacker: on("attacker", "eng-1"), "u-ben": on("u-ben", "eng-1") },
      "u-ash",
      roster,
    );
    expect(out.get("eng-1")?.map((p) => p.name)).toEqual(["Ben"]);
  });

  it("uses a person's most recent tab when they have two open", () => {
    // Two tabs on different engagements: the later meta wins, so you appear on
    // the one you moved to rather than on both.
    const out = groupPresenceByEngagement(
      {
        "u-ben": [
          { phx_ref: "a", id: "u-ben", e: "eng-1" },
          { phx_ref: "b", id: "u-ben", e: "eng-2" },
        ],
      },
      "u-ash",
      roster,
    );
    expect(out.has("eng-1")).toBe(false);
    expect(out.get("eng-2")?.map((p) => p.name)).toEqual(["Ben"]);
  });

  it("groups in roster order so a row does not reshuffle", () => {
    const out = groupPresenceByEngagement(
      { "u-eve": on("u-eve", "e"), "u-ben": on("u-ben", "e"), "u-cam": on("u-cam", "e") },
      "u-ash",
      roster,
    );
    expect(out.get("e")?.map((p) => p.name)).toEqual(["Ben", "Cam", "Eve"]);
  });

  it("is empty before the first sync", () => {
    expect(groupPresenceByEngagement(null, "u-ash", roster).size).toBe(0);
    expect(groupPresenceByEngagement({}, "u-ash", roster).size).toBe(0);
  });
});
