import { test } from "node:test";
import assert from "node:assert/strict";
import { partyTabs, resolveTab, sheetView, marchState, gemSummary, gpText } from "../scripts/party/party-sheet-core.mjs";

test("the GM sees Travel; a player does not; Bastion needs a linked bastion", () => {
  assert.deepEqual(partyTabs({ isGM: true }), ["members", "items", "travel", "quests", "description"]);
  assert.deepEqual(partyTabs({ isGM: false }), ["members", "items", "quests", "description"]);
  assert.deepEqual(partyTabs({ isGM: true, hasBastion: true }), ["members", "items", "travel", "quests", "bastion", "description"]);
  assert.deepEqual(partyTabs({ hasBastion: true }), ["members", "items", "quests", "bastion", "description"]);
});

test("a tab the viewer cannot see falls back to Members", () => {
  const player = partyTabs({});
  assert.equal(resolveTab("travel", player), "members");
  assert.equal(resolveTab("bastion", player), "members");
  assert.equal(resolveTab("items", player), "items");
});

test("view flags: editing follows the party rule, the emblem is the GM's alone", () => {
  assert.deepEqual(sheetView({ isGM: true, canEdit: true }), { isGM: true, canEdit: true, emblemEdit: true });
  assert.deepEqual(sheetView({ isGM: false, canEdit: true }), { isGM: false, canEdit: true, emblemEdit: false });
  assert.deepEqual(sheetView({ isGM: false, canEdit: false }), { isGM: false, canEdit: false, emblemEdit: false });
  assert.deepEqual(sheetView(), { isGM: false, canEdit: false, emblemEdit: false });
});

test("Marching order line: off is free, on names the leader", () => {
  const on = { follow: true, hasToken: true, hasLeader: true, manager: true };
  assert.deepEqual(marchState({ ...on, follow: false }), { mode: "free" });
  assert.deepEqual(marchState(on), { mode: "leads" });
  assert.deepEqual(marchState({ ...on, hasLeader: false }), { mode: "none" });
  // Out on the map but never deployed: the saved arrangement is all there is to say.
  assert.deepEqual(marchState({ ...on, reason: "reload", deployed: false }), { mode: "leads" });
});

test("Marching order line: a pause shows its reason, and only a manager may resume", () => {
  const out = { follow: true, hasToken: true, hasLeader: true, deployed: true, reason: "blocked", pausedMember: "Actor.b" };
  assert.deepEqual(marchState({ ...out, manager: true }), { mode: "paused", reason: "blocked", canResume: true, pausedMember: "Actor.b" });
  assert.equal(marchState({ ...out, manager: false }).canResume, false);
  // Combat is not something to resume from.
  assert.deepEqual(marchState({ ...out, reason: "combat", manager: true }), { mode: "paused", reason: "combat", canResume: false, pausedMember: null });
  // Marching but nothing deployed and nothing paused: leads.
  assert.deepEqual(marchState({ ...out, deployed: true, reason: "", manager: true }), { mode: "leads" });
});

test("Marching order line: no party token is a hint for a manager and nothing for a player", () => {
  const bare = { follow: true, hasToken: false, hasLeader: true };
  assert.deepEqual(marchState({ ...bare, manager: true }), { mode: "notice", reason: "noToken" });
  assert.deepEqual(marchState({ ...bare, manager: false }), { mode: "leads" });
  assert.deepEqual(marchState({ follow: true, hasToken: true, deployed: false, reason: "gathered", hasLeader: true }), { mode: "notice", reason: "gathered" });
});

test("gems: the system's Gem items only, each worth its cost, the total is value times quantity", () => {
  const items = [
    { id: "a", name: "Jade", img: "j.webp", type: "Gem", system: { quantity: 2, cost: { gp: 50, sp: 0, cp: 0 } } },
    { id: "b", name: "Garnet", type: "Gem", system: { quantity: 3, cost: { gp: 25 } } },
    { id: "c", name: "Chip", type: "Gem", system: { quantity: 1, cost: { sp: 5, cp: 7 } } },
    { id: "d", name: "Rope", type: "Basic", system: { quantity: 9, cost: { gp: 1 } } },
    { id: "e", name: "Idol", type: "Treasure", system: { quantity: 1, cost: { gp: 300 } } },
  ];
  const { rows, total, count } = gemSummary(items);
  assert.deepEqual(rows.map((r) => [r.name, r.quantity, r.value]), [["Jade", 2, "50"], ["Garnet", 3, "25"], ["Chip", 1, "0.57"]]);
  assert.equal(total, "175.57");
  assert.equal(count, 6);
});

test("gems: an empty bag, a missing cost and a stack of none add nothing", () => {
  assert.deepEqual(gemSummary([]), { rows: [], total: "0", count: 0 });
  assert.deepEqual(gemSummary(), { rows: [], total: "0", count: 0 });
  const odd = gemSummary([{ name: "x", type: "Gem", system: { quantity: 0, cost: { gp: 10 } } }, { name: "y", type: "Gem", system: {} }]);
  assert.equal(odd.total, "0");
  assert.equal(odd.rows[1].quantity, 1);
  assert.equal(gpText(0), "0");
  assert.equal(gpText(100), "1");
  assert.equal(gpText(5), "0.05");
});
