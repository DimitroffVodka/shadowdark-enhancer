import test from "node:test";
import assert from "node:assert/strict";

// turn-skip.mjs pulls in crawl-state.mjs, which touches Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const settings = { "shadowdark-enhancer.modeChaosInitiative": true };
const cards = [];
const hooks = {};
Object.assign(globalThis, {
  foundry: deep, CONFIG: {}, Hooks: { on: (name, fn) => { hooks[name] = fn; }, once() {} }, ui: {},
  ChatMessage: { create: async (data) => { cards.push(data); } },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
    settings: { get: (ns, key) => settings[`${ns}.${key}`] ?? false },
    i18n: { localize: (k) => k, format: (k) => k },
  },
});
const { maybeSkipDeadTurn, registerTurnSkip } = await import("../scripts/crawl-strip/turn-skip.mjs");
registerTurnSkip();

/**
 * A combat as Foundry runs it on the active GM, as far as Chaos needs: a round
 * change goes through the combatRound hook, then the update, whose turn
 * events fire unless held, then updateCombat. Every dispatch is recorded with
 * the `previous`, `current` and order Foundry's dispatcher would read.
 */
function fakeCombat(people, { round = 2, turn = people.length - 1 } = {}) {
  const who = ([id, type, hp, init]) => ({
    id, name: id, hidden: false, defeated: false, initiative: 0,
    actor: { type, system: { attributes: { hp: { value: hp } } } },
    getInitiativeRoll: () => ({ total: init, formula: "1d20", evaluate: async () => {} }),
  });
  const all = people.map(who);
  const combat = {
    id: "c1", started: true, round, turn, rerolls: 0, reorderEvents: null, events: [],
    turns: [...all],
    combatants: { contents: all, size: all.length },
    _getCurrentState() {
      return { round: this.round, turn: this.turn, combatantId: this.turns[this.turn]?.id ?? null, tokenId: null };
    },
    async _manageTurnEvents() {
      this.events.push({ previous: { ...this.previous }, current: { ...this.current }, order: this.turns.map((c) => c.id) });
    },
    async update(data, options) {
      const prior = this._getCurrentState();
      Object.assign(this, data);
      this.current = this._getCurrentState();
      Object.assign(this.previous, prior);
      if (options.turnEvents !== false) await this._manageTurnEvents();
      hooks.updateCombat(this, data, options);
    },
    async nextTurn() {
      if (this.turn + 1 < this.turns.length) return this.update({ turn: this.turn + 1 }, { direction: 1 });
      const data = { round: this.round + 1, turn: 0 };
      const options = { direction: 1 };
      hooks.combatRound(this, data, options);
      return this.update(data, options);
    },
    async updateEmbeddedDocuments(type, updates, { combatTurn, turnEvents }) {
      this.rerolls += 1;
      this.reorderEvents = turnEvents;
      for (const u of updates) all.find((c) => c.id === u._id).initiative = u.initiative;
      const prior = this._getCurrentState();
      this.turns = [...all].sort((a, b) => b.initiative - a.initiative);
      this.turn = combatTurn;
      this.current = this._getCurrentState();
      Object.assign(this.previous, prior);
      if (turnEvents !== false) await this._manageTurnEvents();
    },
  };
  combat.current = combat._getCurrentState();
  combat.previous = { ...combat.current };
  return combat;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("skipping the last corpse into a new round rerolls Chaos initiative, then skips on the new order", async () => {
  const combat = fakeCombat([["Ana", "Player", 5, 3], ["Corpse", "NPC", 0, 20]]);
  globalThis.game.combat = combat;
  cards.length = 0;
  await maybeSkipDeadTurn(combat);
  await settle();
  assert.equal(combat.round, 3);
  assert.equal(combat.rerolls, 1, "one reroll for the new round");
  assert.equal(cards.length, 1, "one Chaos card");
  assert.equal(combat.turns[combat.turn].name, "Ana", "the corpse rolled to the top and was skipped");
  assert.equal(combat.reorderEvents, false, "the reorder fires nothing of its own");
  // The round's events wait for the reroll, then start the NEW top's turn: the
  // corpse's, which the walk then passes on to Ana.
  assert.deepEqual(combat.events.map((e) => [e.previous.round, e.previous.turn, e.previous.combatantId, e.current.round, e.current.combatantId]), [
    [2, 1, "Corpse", 3, "Corpse"],
    [3, 0, "Corpse", 3, "Ana"],
  ]);
  assert.deepEqual(combat.events[0].order, ["Corpse", "Ana"], "dispatched on the new order");
});

test("a Chaos round starts one turn, the new top's, never the old top's first (#259)", async () => {
  // Round 2 ran Ana, Cy, Bo; round 3 rolls Cy to the top and Ana to the bottom.
  const combat = fakeCombat([["Ana", "Player", 5, 1], ["Cy", "Player", 5, 19], ["Bo", "Player", 5, 2]]);
  globalThis.game.combat = combat;
  await combat.nextTurn();
  await settle();
  assert.equal(combat.round, 3);
  assert.deepEqual(combat.events, [{
    previous: { round: 2, turn: 2, combatantId: "Bo", tokenId: null },
    current: { round: 3, turn: 0, combatantId: "Cy", tokenId: null },
    order: ["Cy", "Bo", "Ana"],
  }], "one dispatch: Bo's turn ends, round 2 ends, round 3 starts, Cy's turn starts");
});

test("turns the old round still owed pass in the old order, skipped, before the reroll", async () => {
  // Skip Defeated: Bo acted last in round 2, so Foundry jumps from turn 1 straight
  // to round 3, over the dying Cy sorted after him.
  const combat = fakeCombat([["Ana", "Player", 5, 18], ["Bo", "Player", 5, 2], ["Cy", "Player", 0, 1]], { turn: 1 });
  globalThis.game.combat = combat;
  const options = { direction: 1 };
  hooks.combatRound(combat, { round: 3, turn: 0 }, options);
  assert.equal(options.turnEvents, false);
  await combat.update({ round: 3, turn: 0 }, options);
  await settle();
  assert.deepEqual(combat.events.map((e) => [e.previous, e.current, e.order]), [
    // The owed turn: Bo's ends, Cy's starts and ends, all in round 2 and the old order.
    [{ round: 2, turn: 1, combatantId: "Bo", tokenId: null }, { round: 2, turn: 3, combatantId: null, tokenId: null }, ["Ana", "Bo", "Cy"]],
    // Then the round: nobody's turn is left to end; round 3 starts on the new top.
    [{ round: 2, turn: 2, combatantId: null, tokenId: null }, { round: 3, turn: 0, combatantId: "Ana", tokenId: null }, ["Ana", "Bo", "Cy"]],
  ]);
});

test("only a Chaos round is held, and only while the active GM can replay it", () => {
  const combat = fakeCombat([["Ana", "Player", 5, 3]]);
  const held = (data, options = { direction: 1 }) => { hooks.combatRound(combat, data, options); return options.turnEvents === false; };
  assert.equal(held({ round: 3, turn: 0 }), true);
  assert.equal(held({ round: 1, turn: 0 }), false, "round 1 is untouched");
  assert.equal(held({ round: 2, turn: 0 }, { direction: -1 }), false, "going back");
  settings["shadowdark.useClockwiseInitiative"] = true;
  assert.equal(held({ round: 3, turn: 0 }), false, "clockwise initiative: Chaos stands down");
  delete settings["shadowdark.useClockwiseInitiative"];
  const gm = globalThis.game.users.activeGM;
  globalThis.game.users.activeGM = null;
  assert.equal(held({ round: 3, turn: 0 }), false, "no active GM to replay it");
  globalThis.game.users.activeGM = gm;
});

test("without Chaos the walk just wraps the round", async () => {
  settings["shadowdark-enhancer.modeChaosInitiative"] = false;
  const combat = fakeCombat([["Ana", "Player", 5, 3], ["Corpse", "NPC", 0, 20]]);
  globalThis.game.combat = combat;
  await maybeSkipDeadTurn(combat);
  await settle();
  assert.equal(combat.rerolls, 0);
  assert.equal(combat.turns[combat.turn].name, "Ana");
  assert.equal(combat.events.length, 1, "the round's own events fire as they are");
  settings["shadowdark-enhancer.modeChaosInitiative"] = true;
});
