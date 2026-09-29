/* global CONFIG */
import test from "node:test";
import assert from "node:assert/strict";

// #290: what the death timer options post to chat, counted at the module's own
// authenticated query entry, the path a crawl round and the GM's buttons take.
const settings = {};
const cards = [];
const queries = [];
let dice = [];
const actors = new Map();
class Roll {
  constructor(formula) { this.formula = formula; }
  async evaluate() { this.dice = [{ total: dice.shift() }]; this.total = this.dice[0].total; return this; }
  async toMessage(_data, opts = {}) { cards.push({ kind: "roll", formula: this.formula, gm: opts.messageMode === "gm" }); }
}
const gm = { id: "gm", isGM: true, active: true };
let players = [];
Object.assign(globalThis, {
  _replace: (v) => v,
  Roll,
  fromUuidSync: (uuid) => actors.get(uuid),
  ChatMessage: {
    getSpeaker: () => ({}),
    create: async (d) => { cards.push({ kind: "line", gm: !!d.whisper?.length }); },
  },
  Hooks: { on() {} },
  CONFIG: { queries: {}, statusEffects: [{ id: "sde-dying" }], Combat: { documentClass: { prototype: { _onStartTurn() {} } } } },
  game: {
    user: gm,
    users: { activeGM: gm, filter: (fn) => [gm, ...players].filter(fn) },
    settings: { get: (ns, key) => settings[key] ?? false },
    i18n: { format: (k) => k },
    modules: { get: () => null },
    combats: [],
    release: { generation: 14 },
  },
});
const { init } = await import("../scripts/dying/dying.mjs");
init();
const send = (data, user = gm) => CONFIG.queries["shadowdark-enhancer.dying"](data, { user });

function pc(id) {
  const actor = {
    id, uuid: `Actor.${id}`, name: id, type: "Player", isOwner: true, isToken: false,
    flags: { "shadowdark-enhancer": { dying: { timer: null, stable: false, conscious: false, tick: null } } },
    statuses: new Set(["sde-dying"]),
    system: { attributes: { hp: { value: 0 } }, abilities: { con: { mod: 0 } } },
    testUserPermission: () => true,
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        const last = parts.pop();
        let at = this;
        for (const p of parts) at = at[p] ??= {};
        at[last] = value;
      }
    },
    async unsetFlag(ns, key) { delete this.flags[ns][key]; },
    async toggleStatusEffect() {},
  };
  actors.set(actor.uuid, actor);
  return actor;
}

/** One dying PC through its first turn, a d20 turn and the GM's +1 round button. */
async function run({ hidden = false, silent = false, online = false, d20 = 5 }) {
  cards.length = 0; queries.length = 0;
  settings.dyingHiddenTimer = hidden; settings.dyingSilentTimer = silent;
  const actor = pc(`a${Math.random()}`);
  players = online ? [{
    id: "p1", active: true, isGM: false, name: "P", character: { id: actor.id },
    query: async (name, payload) => { queries.push(payload); return send(payload, { id: "p1", isGM: false }); },
  }] : [];
  const count = async (step) => { const n = cards.length; await step(); return cards.slice(n); };
  dice = [3];
  const tick1 = await count(() => send({ action: "gm", op: "tick", uuid: actor.uuid, args: { scope: "crawl", round: 1 } }));
  dice = [d20];
  const tick2 = await count(() => send({ action: "gm", op: "tick", uuid: actor.uuid, args: { scope: "crawl", round: 2 } }));
  const button = await count(() => send({ action: "gm", op: "adjust", uuid: actor.uuid, args: { delta: 1 } }));
  return { actor, tick1, tick2, button };
}

const line = (gmOnly) => ({ kind: "line", gm: gmOnly });

for (const online of [false, true]) {
  const who = online ? "a player online" : "no player online";
  test(`default posts every roll and every rounds line (${who})`, async () => {
    const r = await run({ online });
    assert.deepEqual(r.tick1.map((c) => [c.kind, c.gm]), [["roll", false], ["line", false]]);
    assert.deepEqual(r.tick2.map((c) => [c.kind, c.gm]), [["roll", false], ["line", false]]);
    assert.deepEqual(r.button.map((c) => [c.kind, c.gm]), [["line", false]]);
  });

  test(`hidden hides the timer roll and the rounds lines, not the rise check (${who})`, async () => {
    const r = await run({ hidden: true, online });
    assert.deepEqual(r.tick1, [{ kind: "roll", formula: "1d4", gm: true }, line(true)]);
    assert.deepEqual(r.tick2.map((c) => [c.kind, c.gm]), [["roll", false], ["line", true]]);
    assert.deepEqual(r.button, [line(true)]);
  });

  for (const hidden of [false, true]) {
    test(`silent (hidden ${hidden}) posts nothing at all, and the die still counts (${who})`, async () => {
      const r = await run({ silent: true, hidden, online });
      assert.equal(r.tick1.length, 0, "the first turn");
      assert.equal(r.tick2.length, 0, "a d20 turn");
      assert.equal(r.button.length, 0, "the +1 round button");
      // 1d4 gave 3 rounds; the d20 turn took one off; the button added one.
      assert.equal(r.actor.flags["shadowdark-enhancer"].dying.timer, 3);
      assert.equal(queries.length, online ? 1 : 0, "the owner's client still rolls its own die");
    });
  }
}

test("silent: a natural 20 still rises the character", async () => {
  const r = await run({ silent: true, online: true, d20: 20 });
  assert.deepEqual(r.tick2, [line(false)], "the rise announcement, and no roll card");
  assert.equal(r.actor.system.attributes.hp.value, 1);
  assert.equal(r.actor.flags["shadowdark-enhancer"]?.dying, undefined);
});

test("a player cannot send the roll query, so the silent flag cannot hide anyone else's roll", async () => {
  cards.length = 0;
  const actor = pc("victim");
  const reply = await send({ action: "roll", uuid: actor.uuid, formula: "1d20", flavor: "x", silent: true }, { id: "p2", isGM: false });
  assert.equal(reply.ok, false);
  assert.equal(cards.length, 0);
});
