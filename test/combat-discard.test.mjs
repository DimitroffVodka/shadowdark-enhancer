/**
 * The Crawl Bar's Delete Encounter throws a fight away: it deletes the combat
 * with `{ [MODULE_ID]: { discard: true } }`, and the three end-of-combat
 * rewards (Hunter XP, Loot drops, Session Recap's combat entry) skip it.
 * End Encounter deletes without the option and still pays all three.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

const hooks = new Map();
globalThis.Hooks = {
  on: (name, fn) => { (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); },
  callAll: (name, ...args) => (hooks.get(name) ?? []).forEach((fn) => fn(...args)),
};
globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
globalThis.foundry = { applications: { handlebars: {} } };
const gm = { id: "gm1", isGM: true };
globalThis.game = {
  user: gm,
  users: { activeGM: gm },
  settings: { get: () => true },
  modules: { get: () => null },
  actors: { get: () => null },
};

const { init: initHunter } = await import("../scripts/modes-of-play/hunter.mjs");
const { LootDrops } = await import("../scripts/loot/loot-drops.mjs");
const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");

initHunter();
LootDrops.init();
SessionRecap._initCombatHooks();

/** Delete a combat through the hooks; report which rewards ran. */
async function deleteCombat(options) {
  const ran = { hunter: false, loot: false, recap: false };
  LootDrops._onCombatEnd = () => { ran.loot = true; };
  SessionRecap.logCombat = async () => { ran.recap = true; };
  const combat = {
    id: "c1",
    round: 3,
    combatants: {
      get contents() { ran.hunter = true; return []; },
      [Symbol.iterator]: function* () {},
    },
  };
  SessionRecap._activeCombats.set(combat.id, { startTime: 0, participants: [] });
  globalThis.Hooks.callAll("deleteCombat", combat, options, gm.id);
  await new Promise(setImmediate);
  assert.equal(SessionRecap._activeCombats.has(combat.id), false, "recap stops tracking the combat either way");
  return ran;
}

test("End Encounter (a plain delete) pays Hunter XP, rolls loot and logs the fight", async () => {
  assert.deepEqual(await deleteCombat({}), { hunter: true, loot: true, recap: true });
});

test("Delete Encounter's discard option skips Hunter XP, loot drops and the recap entry", async () => {
  assert.deepEqual(await deleteCombat({ [MODULE_ID]: { discard: true } }), { hunter: false, loot: false, recap: false });
});
