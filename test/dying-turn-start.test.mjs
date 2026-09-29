/**
 * Dying's turn start (#181) for a GM signed in twice (#288). Foundry runs
 * Combat#_onStartTurn in every tab of the active GM: it checks the user
 * (`game.user.isActiveGM`), not the tab. Without the tab check the waiting tab
 * rolled the death timer too, asking the player a second time and writing the
 * flag again. Its own file: dying.mjs uses the relay's one module instance, and
 * this process makes that instance the waiting tab, then hands it the lock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

const GM = { id: "gm1", isGM: true, active: true };
const asked = [];    // what the owning player was asked to roll
const writes = [];   // the PC's flag writes
const player = { id: "p1", isGM: false, active: true, query: async (name, data) => { asked.push(data.action); return { ok: true, natural: 3 }; } };
const aria = {
  id: "aria", uuid: "Actor.aria", name: "Aria", type: "Player", statuses: new Set(),
  flags: { [MODULE_ID]: { dying: { timer: null, stable: false, conscious: false, tick: null } } },
  system: { abilities: { con: { mod: 0 } } },
  testUserPermission: (u) => u === player,
  async update(data) { writes.push(data); },
};

globalThis._replace = (v) => v;
globalThis.Hooks = { on() {} };
globalThis.ChatMessage = { create: async () => ({}), getSpeaker: () => ({}) };
globalThis.CONFIG = { statusEffects: [], queries: {}, Combat: { documentClass: class { async _onStartTurn() {} } } };
globalThis.game = {
  user: GM, userId: GM.id, users: Object.assign([GM, player], { activeGM: GM }),
  modules: { get: () => null }, settings: { get: () => false }, i18n: { localize: (k) => k, format: (k) => k },
};

const { claimGmTab } = await import("../scripts/shared/gm-relay.mjs");
const { init } = await import("../scripts/dying/dying.mjs");
init();

/** Another tab holds the lock; `grant()` is that tab closing. */
let grant = null;
const locks = {
  request(name, options, callback) {
    if (options?.ifAvailable) return Promise.resolve(callback(null));
    return new Promise(() => { grant = () => callback({ name }); });
  },
};
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };

test("a GM signed in twice rolls a dying PC's death timer in one tab: the waiting tab leaves it (#288)", async () => {
  claimGmTab(GM.id, "b1", locks);
  await flush();
  const combat = Object.assign(new globalThis.CONFIG.Combat.documentClass(), { id: "c1", round: 1 });
  await combat._onStartTurn({ actor: aria }, { round: 1 });
  await flush();
  assert.deepEqual(asked, [], "the waiting tab doesn't ask the player to roll");
  assert.equal(writes.length, 0, "or write the flag");
  grant();
  await combat._onStartTurn({ actor: aria }, { round: 1 });
  await flush();
  assert.deepEqual(asked, ["roll"], "the working tab asks once");
  assert.equal(writes.length, 1);
});
