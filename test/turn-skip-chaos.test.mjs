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
 * the `previous`, `current` and order Foundry's dispatcher reads before its
 * first await, and the `current` an update landing after that await would see.
 * An initiative given as a list is one roll after another.
 */
function fakeCombat(people, { round = 2, turn = people.length - 1, onReorder = null, failDispatch = null } = {}) {
  const who = ([id, type, hp, init]) => ({
    id, name: id, hidden: false, defeated: false, initiative: 0,
    actor: { type, system: { attributes: { hp: { value: hp } } } },
    getInitiativeRoll: () => ({ total: Array.isArray(init) ? init.shift() : init, formula: "1d20", evaluate: async () => {} }),
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
      const event = { previous: { ...this.previous }, current: { ...this.current }, order: this.turns.map((c) => c.id) };
      this.events.push(event);
      if (failDispatch?.(event)) throw new Error("a turn handler failed");
      await null;
      event.meanwhile = { ...this.current };
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
      await onReorder?.(this);
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
    meanwhile: { round: 3, turn: 0, combatantId: "Cy", tokenId: null },
  }], "one dispatch: Bo's turn ends, round 2 ends, round 3 starts, Cy's turn starts");
});

test("turns the old round still owed pass in the old order, skipped, before the reroll", async () => {
  // Skip Defeated: Bo acted last in round 2, so Foundry jumps from turn 1 straight
  // to round 3, over the dying Cy sorted after him. Cy then rolls to the top.
  const combat = fakeCombat([["Ana", "Player", 5, 1], ["Bo", "Player", 5, 2], ["Cy", "Player", 0, 18]], { turn: 1 });
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
    [{ round: 2, turn: 2, combatantId: null, tokenId: null }, { round: 3, turn: 0, combatantId: "Cy", tokenId: null }, ["Cy", "Bo", "Ana"]],
  ]);
  // An update landing while the events run sees the real state, never the made-up one.
  assert.deepEqual(combat.events.map((e) => e.meanwhile), [
    { round: 3, turn: 0, combatantId: "Ana", tokenId: null },
    { round: 3, turn: 0, combatantId: "Cy", tokenId: null },
  ]);
  assert.deepEqual(combat.previous, { round: 2, turn: 1, combatantId: "Bo", tokenId: null },
    "and `previous` is left where Foundry leaves it after a round, at the old round's last turn");
});

test("a round held again while the first is replayed is replayed once, from where the first left off", async () => {
  // The GM double-clicks Next Round: round 4 is held while round 3's reroll is
  // still going out. Round 3 rolls Cy, Bo, Ana; round 4 rolls Bo, Ana, Cy.
  const combat = fakeCombat([["Ana", "Player", 5, [1, 10]], ["Bo", "Player", 5, [2, 20]], ["Cy", "Player", 5, [18, 1]]], {
    onReorder: async (c) => {
      if (c.round !== 3) return;
      const options = { direction: 1 };
      hooks.combatRound(c, { round: 4, turn: 0 }, options);
      await c.update({ round: 4, turn: 0 }, options);
    },
  });
  globalThis.game.combat = combat;
  cards.length = 0;
  await combat.nextTurn();
  await settle(); await settle();
  assert.equal(combat.round, 4);
  assert.deepEqual(combat.events.map((e) => [e.previous.round, e.previous.turn, e.previous.combatantId, e.current.round, e.current.turn, e.current.combatantId, e.order.join()]), [
    [2, 2, "Cy", 3, 0, "Cy", "Cy,Bo,Ana"],      // round 3 starts on its new top, Cy
    [3, 0, "Cy", 3, 3, null, "Cy,Bo,Ana"],      // round 3's other turns pass, skipped, in its order
    [3, 2, null, 4, 0, "Bo", "Bo,Ana,Cy"],      // round 4 starts on its new top, Bo
  ], "each round's events once, in order");
  assert.deepEqual(cards.map((c) => c.flags["shadowdark-enhancer"].chaosRound), [3, 4], "one card per round, each naming its own");
});

// The GM double-clicks Next Round: round 4 is held while round 3's reroll is still going out.
const doubleClick = async (c) => {
  if (c.round !== 3) return;
  const options = { direction: 1 };
  hooks.combatRound(c, { round: 4, turn: 0 }, options);
  await c.update({ round: 4, turn: 0 }, options);
};
const quietly = async (fn) => {
  const error = console.error;
  console.error = () => {};
  try { await fn(); } finally { console.error = error; }
};

test("a round whose events fail still hands on where it ended, so the next never fires twice", async () => {
  const combat = fakeCombat([["Ana", "Player", 5, [1, 10]], ["Bo", "Player", 5, [2, 20]], ["Cy", "Player", 5, [18, 1]]], {
    onReorder: doubleClick,
    failDispatch: (e) => e.current.round === 3 && e.current.turn === 0,
  });
  globalThis.game.combat = combat;
  await quietly(async () => { await combat.nextTurn(); await settle(); await settle(); });
  assert.deepEqual(combat.events[1].previous, { round: 3, turn: 0, combatantId: "Cy", tokenId: null },
    "round 4's replay starts from round 3's new top, not from what was taken mid-replay");
  assert.deepEqual(combat.events.at(-1).current, { round: 4, turn: 0, combatantId: "Bo", tokenId: null });
});

test("a round held while an unheld reroll runs is replayed right after it, not a round late", async () => {
  // A macro sets round 3 itself, so it is not held; meanwhile round 4 is.
  const combat = fakeCombat([["Ana", "Player", 5, [1, 10]], ["Bo", "Player", 5, [2, 20]], ["Cy", "Player", 5, [18, 1]]], { onReorder: doubleClick });
  globalThis.game.combat = combat;
  cards.length = 0;
  await combat.update({ round: 3, turn: 0 }, { direction: 1 });
  await settle(); await settle();
  assert.equal(combat.rerolls, 2, "round 3's reroll, then round 4's");
  assert.deepEqual(cards.map((c) => c.flags["shadowdark-enhancer"].chaosRound), [3, 4], "each card names its own round");
  assert.deepEqual(combat.events.at(-1).current, { round: 4, turn: 0, combatantId: "Bo", tokenId: null }, "round 4 starts on its new top");
});

test("a held round's events go out even when nothing rerolls it", async () => {
  // Not the combat on screen: its round is replayed as it stands, no reroll.
  const combat = fakeCombat([["Ana", "Player", 5, 1], ["Bo", "Player", 5, 2]]);
  globalThis.game.combat = { id: "elsewhere" };
  await combat.nextTurn();
  await settle();
  assert.equal(combat.rerolls, 0);
  assert.deepEqual(combat.events.map((e) => [e.previous.combatantId, e.current.round, e.current.combatantId]), [["Bo", 3, "Ana"]]);
});

test("a reroll that fails still lets the round start", async () => {
  const combat = fakeCombat([["Ana", "Player", 5, 1], ["Bo", "Player", 5, 2]], {
    onReorder: async () => { throw new Error("the server said no"); },
  });
  globalThis.game.combat = combat;
  const error = console.error;
  console.error = () => {};
  try {
    await combat.nextTurn();
    await settle();
  } finally {
    console.error = error;
  }
  assert.deepEqual(combat.events.map((e) => [e.previous.combatantId, e.current.round, e.current.combatantId]), [["Bo", 3, "Ana"]],
    "the old order's top starts round 3");
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
