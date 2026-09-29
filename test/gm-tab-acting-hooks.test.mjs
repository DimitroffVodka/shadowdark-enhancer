/**
 * Hooks that fire only in the tab that acted, for a GM signed in twice (#288).
 * v14 fires `combatStart` only in the client that called startCombat
 * (client/documents/combat.mjs), and `preUpdateItem` / `preDeleteItem` only in
 * the client that asked for the change (client/data/client-backend.mjs). The
 * first tab opened holds the lock, so a GM with a second tab usually acts in
 * the waiting one: a lock check on those hooks dropped the fight from the
 * recap and the Scavenger roll. Each tab here is its own copy of scripts/, so
 * each has its own relay, its own lock answer and its own hooks.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GM = { id: "gm1", isGM: true, active: true };
const player = { id: "p1", isGM: false, active: false };   // offline, so the active GM rolls for the PC
const logged = [];   // recap combat entries, from either tab
const rolls = [];    // Scavenger d6s, from either tab

globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
globalThis.foundry = {
  applications: { handlebars: {} },
  utils: { getProperty: (o, path) => path.split(".").reduce((v, k) => v?.[k], o) },
};
globalThis.Roll = class { async evaluate() { rolls.push(this); this.total = 1; return this; } async toMessage() {} };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.game = {
  user: GM,
  users: Object.assign([GM, player], { activeGM: GM }),
  // The recap is running, and Scavenger is on (every setting read is truthy).
  settings: { get: () => ({ sessionState: "active" }) },
  modules: { get: () => null },
  actors: { get: () => null },
  i18n: { localize: (k) => k, format: (k) => k },
};

const root = mkdtempSync(join(tmpdir(), "sde-tabs-"));
after(() => rmSync(root, { recursive: true, force: true }));
const scripts = fileURLToPath(new URL("../scripts", import.meta.url));

/** A tab signed in as the GM: its own copy of the module. `holds`: the lock's answer. */
async function openTab(name, holds) {
  const dir = join(root, name);
  cpSync(scripts, dir, { recursive: true });
  const hooks = new Map();
  globalThis.Hooks = { on: (hook, fn) => { (hooks.get(hook) ?? hooks.set(hook, []).get(hook)).push(fn); } };
  const load = (path) => import(pathToFileURL(join(dir, path)).href);
  const { claimGmTab } = await load("shared/gm-relay.mjs");
  const { SessionRecap } = await load("session-recap/session-recap.mjs");
  const { init } = await load("scavenger/scavenger.mjs");
  claimGmTab(GM.id, "b1", {
    request: (lock, options, callback) => (options?.ifAvailable
      ? Promise.resolve(callback(holds ? { name: lock } : null))
      : new Promise(() => {})),
  });
  SessionRecap._initCombatHooks();
  SessionRecap.logCombat = async (entry) => { logged.push(entry.id); };
  init();
  return { name, fire: (hook, ...args) => Promise.all((hooks.get(hook) ?? []).map((fn) => fn(...args))) };
}

const working = await openTab("working", true);
const waiting = await openTab("waiting", false);
const everyTab = (hook, ...args) => Promise.all([working, waiting].map((t) => t.fire(hook, ...args)));
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };

test("a fight started in either tab of a GM signed in twice reaches the recap once (#288)", async () => {
  for (const acting of [waiting, working]) {
    const combat = { id: `fight-${acting.name}`, round: 0, combatants: [] };
    await acting.fire("combatStart", combat, { round: 1, turn: 0 });
    combat.round = 1;
    await everyTab("updateCombat", combat, { round: 1, turn: 0 });
    await everyTab("deleteCombat", combat, {});
  }
  assert.deepEqual(logged, ["fight-waiting", "fight-working"]);
});

test("the active GM spending a PC's last torch in either of its tabs rolls Scavenger once (#288)", async () => {
  const aria = {
    documentName: "Actor", type: "Player",
    items: [{ type: "Talent", name: "Scavenger" }],
    testUserPermission: (u) => u === player,
  };
  for (const acting of [waiting, working]) {
    rolls.length = 0;
    const torch = { uuid: `Actor.aria.Item.${acting.name}`, id: acting.name, name: "Torch", type: "Basic", system: { quantity: 1 }, parent: aria };
    const changes = { system: { quantity: 0 } };
    await acting.fire("preUpdateItem", torch, changes);
    torch.system.quantity = 0;
    await everyTab("updateItem", torch, changes);
    await flush();
    assert.equal(rolls.length, 1, `spent in the ${acting.name} tab`);
  }
});
