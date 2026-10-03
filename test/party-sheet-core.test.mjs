import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { partyTabs, resolveTab, sheetView, marchState, gemSummary, gpText, linkedBastion, lastMonthEntry, roomIcon, ROOM_ICONS, MONTH_LOG_KEYS, terrainLabel, lightReadout, rationsCount, statusBar, TAB_LABELS, TAB_ICONS, tabRow, movementMessageKey, marchText } from "../scripts/party/party-sheet-core.mjs";

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

test("the party's bastion is the one whose party link is this party and the viewer may see", () => {
  const mine = "Actor.party1";
  const castle = { name: "Castle", system: { party: mine } }, hold = { name: "Anchor Hold", system: { party: mine } };
  const other = { name: "Other", system: { party: "Actor.party2" } }, unlinked = { name: "Loose", system: { party: "" } };
  assert.equal(linkedBastion(mine, [castle, other, unlinked, hold]), hold, "several: the first by name");
  assert.equal(linkedBastion(mine, [other, unlinked]), null, "none linked: no tab");
  assert.equal(linkedBastion(mine, [castle, hold], (b) => b === castle), castle, "a bastion the viewer cannot see is skipped");
  assert.equal(linkedBastion(mine, [castle], () => false), null);
  assert.equal(linkedBastion("", [unlinked]), null, "an empty party uuid never matches an unlinked bastion");
  assert.equal(linkedBastion(mine), null);
});

test("last month is the newest month result, not a build or a deposit", () => {
  const log = [
    { key: "SDE.bastion.log.quietMonth", data: { d6: 3 } },
    { key: "SDE.bastion.log.buildStarted", data: {} },
    { key: "SDE.bastion.log.deposited", data: {} },
  ];
  assert.equal(lastMonthEntry(log).key, "SDE.bastion.log.quietMonth");
  assert.equal(lastMonthEntry([...log, { key: "SDE.bastion.log.dragon" }]).key, "SDE.bastion.log.dragon");
  assert.equal(lastMonthEntry([{ key: "SDE.bastion.log.buildDone" }]), null);
  assert.equal(lastMonthEntry([]), null);
  assert.equal(lastMonthEntry(), null);
  assert.ok(MONTH_LOG_KEYS.every((k) => k.startsWith("SDE.bastion.log.")));
});

test("every bastion upgrade has a room icon, and an unknown one falls back to the door", async () => {
  const { BASTION_UPGRADES } = await import("../scripts/bastion/bastion-core.mjs");
  assert.deepEqual(BASTION_UPGRADES.map((u) => u.id).filter((id) => !ROOM_ICONS[id]), []);
  assert.equal(roomIcon("nonsense"), "fa-door-open");
  assert.equal(roomIcon("stable"), "fa-horse");
});

// The words come from the real en.json: a key that does not exist shows as itself, and a test notices.
const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
const sys = { "SDE.overland.badgeHexes": "{left} of {budget} hexes left" };
const say = (key) => en[key] ?? sys[key] ?? `?${key}`;
const sayWith = (key, data) => say(key).replace(/\{(\w+)\}/g, (_, k) => data[k]);
const words = { say, sayWith };
const torch = (mins, active = true, id = "t") => ({ id, name: "Torch", type: "Basic", system: { light: { isSource: true, active, remainingSecs: mins * 60, longevityMins: 60 } } });

test("terrain reads as words, and unknown terrain is nothing", () => {
  assert.equal(terrainLabel("forest"), "Forest");
  assert.equal(terrainLabel("salt_flat"), "Salt flat");
  assert.equal(terrainLabel(""), null);
  assert.equal(terrainLabel(null), null);
  assert.equal(terrainLabel(undefined), null);
  assert.equal(terrainLabel("  "), null);
});

test("light: the burning source with the most time left, across the party and its members", () => {
  assert.deepEqual(lightReadout([[torch(12)], [torch(38)], [torch(90, false)]]), { name: "Torch", mins: 38 });
  assert.equal(lightReadout([[torch(30, false)], []]), null, "carried but not lit is not a light");
  assert.equal(lightReadout([]), null);
  assert.equal(lightReadout(), null);
  const spell = { id: "s", name: "Light", type: "Effect", system: { light: { isSource: true, active: true, remainingSecs: 3600, longevityMins: 60 } } };
  assert.deepEqual(lightReadout([[spell], [torch(5)]]), { name: "Light", mins: 60 });
});

test("rations count Basic stacks named Rations, and nothing else", () => {
  const stack = (name, quantity, type = "Basic") => ({ name, type, system: { quantity } });
  assert.equal(rationsCount([[stack("Rations", 5), stack("Ration", 2), stack("Rations (iron)", 9), stack("Rations", 3, "Treasure")], [stack("rations", 4)]]), 11);
  assert.equal(rationsCount([[]]), 0);
  assert.equal(rationsCount(), 0);
  assert.equal(rationsCount([[{ name: "Rations", type: "Basic", system: { quantity: "x" } }]]), 0);
});

test("status bar: Today, Light and Rations each appear only with data", () => {
  const travel = { terrain: "forest", weather: "Fair", hexesLeft: 3, budget: 4 };
  assert.deepEqual(statusBar({ travel, light: { name: "Torch", mins: 38 }, rations: 12 }, words), [
    { key: "today", label: "Today", icon: "fa-person-walking", value: "Forest \u00b7 Fair \u00b7 3 of 4 hexes left" },
    { key: "light", label: "Light", icon: "fa-fire", value: "Torch, 38 min" },
    { key: "rations", label: "Rations", icon: "fa-drumstick-bite", value: "12", low: false },
  ]);
  assert.deepEqual(statusBar({}, words), [], "nothing available: no bar");
  assert.deepEqual(statusBar({ rations: 0 }, words), [{ key: "rations", label: "Rations", icon: "fa-drumstick-bite", value: "0", low: true }], "none left is worth showing, and low");
  assert.deepEqual(statusBar({ light: { name: "Torch", mins: null } }, words).map((r) => r.value), ["Torch"]);
});

test("status bar: Today leaves out what it does not know and shows nothing when it knows nothing", () => {
  const only = (travel) => statusBar({ travel }, words).map((r) => r.value);
  assert.deepEqual(only({ terrain: null, weather: "Stormy", hexesLeft: 0, budget: 4 }), ["Stormy \u00b7 0 of 4 hexes left"]);
  assert.deepEqual(only({ terrain: "hills", weather: null, hexesLeft: 0, budget: 0 }), ["Hills"], "no day open: no hex count");
  assert.deepEqual(only({ terrain: null, weather: null, hexesLeft: 0, budget: 0 }), []);
  assert.deepEqual(only(null), []);
});

test("every tab has a name and an icon, and the row marks the active one", () => {
  const keys = partyTabs({ isGM: true, hasBastion: true });
  assert.deepEqual(Object.keys(TAB_LABELS).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(TAB_ICONS).sort(), [...keys].sort());
  const row = tabRow(keys, "items", say);
  assert.deepEqual(row.map((t) => t.label), ["Members", "Items", "Travel", "Quests", "Bastion", "Description"]);
  assert.deepEqual(row.filter((t) => t.active).map((t) => t.key), ["items"]);
});

test("every movement pause has its own message, and the Marching order line says it", () => {
  for (const reason of ["noToken", "free", "combat", "scene", "reload", "gathered", "leader", "teleport", "missing", "blocked"]) {
    assert.notEqual(movementMessageKey(reason), "SDE.party.movement.unknown", reason);
    assert.ok(en[movementMessageKey(reason)], reason);
  }
  assert.equal(movementMessageKey("???"), "SDE.party.movement.unknown");
  const names = { leaderName: "Creeg", pausedName: "Iraga", missing: "Missing member" };
  assert.equal(marchText({ mode: "leads" }, names, words).text, "Creeg leads");
  assert.equal(marchText({ mode: "leads" }, { missing: "Missing member" }, words).text, "Missing member leads", "a leader who is gone is named as missing, not undefined");
  assert.equal(marchText({ mode: "free" }, names, words).text, "Moving freely");
  assert.equal(marchText({ mode: "none" }, names, words).text, "");
  const blocked = marchText({ mode: "paused", reason: "blocked", pausedMember: "Actor.i", canResume: true }, names, words);
  assert.equal(blocked.warn, true);
  assert.match(blocked.text, /^Paused: .* Iraga$/);
  assert.equal(marchText({ mode: "paused", reason: "leader", canResume: true }, names, words).text, en["SDE.party.movement.leader"]);
  assert.equal(marchText({ mode: "notice", reason: "noToken" }, names, words).text, en["SDE.party.movement.noToken"]);
  assert.equal(marchText({ mode: "notice", reason: "gathered" }, names, words).warn, undefined);
});
