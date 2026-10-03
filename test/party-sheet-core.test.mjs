import { test } from "node:test";
import assert from "node:assert/strict";
import { partyTabs, resolveTab, sheetView, marchState } from "../scripts/party/party-sheet-core.mjs";

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
