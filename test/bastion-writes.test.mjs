/**
 * Moving gold between a purse and a bastion's treasury (bastion-writes.mjs). In v14 an update can save and then
 * throw (a hook's _onUpdate failing, #284): the gold must never vanish or double when that happens.
 */
import test from "node:test";
import assert from "node:assert/strict";

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = value;
}

// A document whose update applies its changes; `throwAfterSave` makes the next one throw once it has saved.
function doc(data) {
  return Object.assign(data, {
    throwAfterSave: false,
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
      if (this.throwAfterSave) { this.throwAfterSave = false; throw new Error("_onUpdate failed"); }
      return this;
    },
  });
}

async function setup({ purse = 100, treasury = 0 } = {}) {
  const person = doc({ uuid: "Actor.pc", name: "Vella", type: "Player", system: { coins: { gp: purse, sp: 0, cp: 0 } } });
  const bastion = doc({
    name: "Keep", img: "keep.webp", prototypeToken: { texture: { src: "keep.webp" } },
    system: { type: "house", weeksLeft: 0, week: 1, hp: { value: 10 }, treasury, party: null, log: [] },
  });
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k },
    actors: { get: () => null, filter: (fn) => [person].filter(fn) },
  };
  globalThis.ui = { notifications: { warn() {}, info() {} } };
  globalThis.foundry = { applications: { api: { DialogV2: { prompt: async () => ({ who: "Actor.pc", gp: 50 }) } } } };
  const { fundBastion } = await import("../scripts/bastion/bastion-writes.mjs");
  return { person, bastion, fundBastion, total: () => person.system.coins.gp + bastion.system.treasury };
}

test("a deposit whose purse write saves and then throws still reaches the treasury", async () => {
  const s = await setup({ purse: 100, treasury: 0 });
  s.person.throwAfterSave = true;
  assert.equal(await s.fundBastion(s.bastion, "deposit"), true);
  assert.equal(s.person.system.coins.gp, 50);
  assert.equal(s.bastion.system.treasury, 50);
  assert.equal(s.total(), 100, "no gold lost or made");
});

test("a withdrawal whose treasury write saves and then throws still pays the purse", async () => {
  const s = await setup({ purse: 0, treasury: 100 });
  s.bastion.throwAfterSave = true;
  assert.equal(await s.fundBastion(s.bastion, "withdraw"), true);
  assert.equal(s.bastion.system.treasury, 50);
  assert.equal(s.person.system.coins.gp, 50);
  assert.equal(s.total(), 100, "no gold lost or made");
});
