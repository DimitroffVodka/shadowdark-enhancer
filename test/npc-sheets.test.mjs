// The Mount and Warband sheets share one NPC stat block (npc-stat-sheet.mjs, templates/actors/npc-stat/): every control in
// their templates must reach a handler, and the shared markup must be preloaded by both. ApplicationV2 is stubbed
// (helpers/appv2-stub.mjs): the template and the action table are all this can check; how it looks is the design
// harness's job and how it behaves is a live world's.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { installAppV2Stub, mergedActions } from "./helpers/appv2-stub.mjs";

installAppV2Stub();
const { NpcStatSheet, NPC_STAT_PARTIALS } = await import("../scripts/actors/npc-stat-sheet.mjs");
const { MountSheet } = await import("../scripts/actors/mount-sheet.mjs");
const { WarbandSheet } = await import("../scripts/actors/warband-sheet.mjs");

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const MOD_PREFIX = "modules/shadowdark-enhancer/";
const TEMPLATES = { [MountSheet.name]: "templates/actors/mount-sheet.hbs", [WarbandSheet.name]: "templates/actors/warband-sheet.hbs" };

/** A template with the partials it includes spliced in, as it renders. */
function withPartials(path) {
  return read(path).replace(/\{\{>\s*"([^"]+)"\s*\}\}/g, (_, partial) => withPartials(partial.replace(MOD_PREFIX, "")));
}
const actionsIn = (html) => [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]))];

// What the Mount's actions came to before the stat block moved into the shared class: none may be lost.
const MOUNT_ACTIONS_BEFORE = [
  "changeTab", "editImage", "toggleEditStats", "rollAbility", "rollHp", "placeTokens", "openOccupant", "removeOccupant", "openItem",
  "deleteItem", "itemCreate", "effectControl", "levelUp", "push", "morale", "personality", "applyBase", "item-attack",
  "display-feature", "cast-npc-spell", "focus-npc-spell", "toggle-lost", "show-details",
];

for (const Sheet of [MountSheet, WarbandSheet]) {
  test(`${Sheet.name}: every data-action in its template, and in the system's attack markup, has a handler`, () => {
    const actions = mergedActions(Sheet);
    // The system's own npc-attack partial (rendered into the attack lines) carries this one.
    const used = [...actionsIn(withPartials(TEMPLATES[Sheet.name])), "item-attack"];
    for (const name of used) assert.equal(typeof actions[name], "function", `${name} has no handler on ${Sheet.name}`);
    for (const [name, handler] of Object.entries(actions)) assert.equal(typeof handler, "function", `${name} is not a function`);
  });

  test(`${Sheet.name}: the stat block's actions come from the shared class, once`, () => {
    const actions = mergedActions(Sheet);
    const shared = mergedActions(NpcStatSheet);
    for (const [name, handler] of Object.entries(shared)) assert.equal(actions[name], handler, `${name} was replaced on ${Sheet.name}`);
    assert.ok(Object.hasOwn(NpcStatSheet.DEFAULT_OPTIONS.actions, "item-attack"));
  });

  test(`${Sheet.name}: its tabs are the ones its template draws, and the first is open`, () => {
    const html = withPartials(TEMPLATES[Sheet.name]);
    const tabs = Sheet.STAT_TABS.map(([id]) => id);
    assert.deepEqual([...html.matchAll(/data-tab-content="([^"]+)"/g)].map((m) => m[1]), tabs);
    assert.equal(Object.create(Sheet.prototype)._activeTab, undefined, "set per instance");
    assert.equal(new Sheet()._activeTab, tabs[0]);
  });

  test(`${Sheet.name}: the shared partials it includes are the ones it preloads, and they exist`, () => {
    const html = read(TEMPLATES[Sheet.name]);
    const included = [...html.matchAll(/\{\{>\s*"([^"]+)"\s*\}\}/g)].map((m) => m[1]);
    const preloaded = Sheet.PARTS.body.templates;
    assert.deepEqual(preloaded, NPC_STAT_PARTIALS);
    for (const partial of included) assert.ok(preloaded.includes(partial), `${partial} is not preloaded`);
    for (const partial of preloaded) assert.ok(existsSync(new URL(partial.replace(MOD_PREFIX, ""), root)), `${partial} is missing`);
    assert.ok(existsSync(new URL(Sheet.PARTS.body.template.replace(MOD_PREFIX, ""), root)));
  });
}

test("the Mount still has every action it had before the stat block was shared", () => {
  assert.deepEqual(Object.keys(mergedActions(MountSheet)).sort(), [...MOUNT_ACTIONS_BEFORE].sort());
});

test("the Warband's own actions are the Warband tab's and nothing else, and none is a Mount rule", () => {
  const own = Object.keys(WarbandSheet.DEFAULT_OPTIONS.actions).sort();
  assert.deepEqual(own, ["clearCommander", "openCommander", "payArrears", "readUpgradeText", "returnToService", "runMonth"]);
  const actions = mergedActions(WarbandSheet);
  for (const mountOnly of ["levelUp", "push", "morale", "personality", "applyBase", "placeTokens", "toggleEditStats"]) assert.equal(actions[mountOnly], undefined);
});

test("the Warband sheet does not write the warband flag itself", () => {
  const source = read("scripts/actors/warband-sheet.mjs");
  assert.doesNotMatch(source, /replaceModuleFlag|setFlag|\.update\(/, "every change goes through the writer");
});

test("a viewer who can't edit is left only anchors and images for what they may click", () => {
  // DocumentSheetV2 disables every form control for a viewer without edit rights: what an observer may use must not be one.
  const html = withPartials(TEMPLATES[WarbandSheet.name]);
  const buttons = [...html.matchAll(/<button[^>]*data-action="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons.sort(), ["clearCommander", "payArrears", "readUpgradeText", "returnToService", "runMonth"], "editing and GM controls only");
  for (const open of ['data-action="openCommander"', 'data-action="changeTab"', 'data-action="rollAbility"']) {
    assert.doesNotMatch(html.match(new RegExp(`<[^>]*${open}[^>]*>`))?.[0] ?? "", /^<button/, `${open} must not be a button`);
  }
});
