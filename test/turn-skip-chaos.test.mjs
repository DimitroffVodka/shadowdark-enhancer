import test from "node:test";
import assert from "node:assert/strict";

// turn-skip.mjs pulls in crawl-state.mjs, which touches Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const settings = { "shadowdark-enhancer.modeChaosInitiative": true };
const cards = [];
Object.assign(globalThis, {
  foundry: deep, CONFIG: {}, Hooks: { on() {}, once() {} }, ui: {},
  ChatMessage: { create: async (data) => { cards.push(data); } },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
    settings: { get: (ns, key) => settings[`${ns}.${key}`] ?? false },
    i18n: { localize: (k) => k, format: (k) => k },
  },
});
const { maybeSkipDeadTurn } = await import("../scripts/crawl-strip/turn-skip.mjs");

function fakeCombat() {
  const who = (id, type, hp, init) => ({
    id, name: id, hidden: false, defeated: false, initiative: 0,
    actor: { type, system: { attributes: { hp: { value: hp } } } },
    getInitiativeRoll: () => ({ total: init, formula: "1d20", evaluate: async () => {} }),
  });
  const ana = who("Ana", "Player", 5, 3);
  const corpse = who("Corpse", "NPC", 0, 20);
  const combat = {
    id: "c1", started: true, round: 2, turn: 1, rerolls: 0,
    turns: [ana, corpse],
    combatants: { contents: [ana, corpse] },
    async nextTurn() {
      if (this.turn + 1 >= this.turns.length) { this.round += 1; this.turn = 0; } else this.turn += 1;
    },
    async updateEmbeddedDocuments(type, updates, { combatTurn }) {
      this.rerolls += 1;
      for (const u of updates) this.combatants.contents.find((c) => c.id === u._id).initiative = u.initiative;
      this.turns = [...this.combatants.contents].sort((a, b) => b.initiative - a.initiative);
      this.turn = combatTurn;
    },
  };
  return combat;
}

test("skipping the last corpse into a new round rerolls Chaos initiative, then skips on the new order", async () => {
  const combat = fakeCombat();
  globalThis.game.combat = combat;
  cards.length = 0;
  await maybeSkipDeadTurn(combat);
  assert.equal(combat.round, 3);
  assert.equal(combat.rerolls, 1, "one reroll for the new round");
  assert.equal(cards.length, 1, "one Chaos card");
  assert.equal(combat.turns[combat.turn].name, "Ana", "the corpse rolled to the top and was skipped");
});

test("without Chaos the walk just wraps the round", async () => {
  settings["shadowdark-enhancer.modeChaosInitiative"] = false;
  const combat = fakeCombat();
  globalThis.game.combat = combat;
  await maybeSkipDeadTurn(combat);
  assert.equal(combat.rerolls, 0);
  assert.equal(combat.turns[combat.turn].name, "Ana");
  settings["shadowdark-enhancer.modeChaosInitiative"] = true;
});
