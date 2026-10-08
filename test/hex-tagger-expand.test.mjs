import test from "node:test";
import assert from "node:assert/strict";

// "These are not all the same" on a Legend card, through the real HexTaggerApp._expandCards. Nothing here
// talks to a Foundry world.
globalThis.Hooks = { on: () => 1, off: () => {}, callAll: () => {} };
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} } },
  utils: { escapeHTML: (s) => s, randomID: () => "x" },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const { HexTaggerApp, EXPAND_PICKS, SPLIT } = await import("../scripts/hex-map/hex-tagger-app.mjs");

/** Open one card (members 1..size) and return the hexes it asks about. */
function opened(size, samples) {
  const app = Object.create(HexTaggerApp.prototype);
  const members = Array.from({ length: size }, (_, i) => i + 1);
  app._legend = [{ members, samples, size }];
  app.render = () => {};
  app._expandCards([0]);
  return { card: app._legend[0], members };
}

test("an opened card asks about the pictures the GM was shown, then a spread of the rest", () => {
  // The minority look sits at the tail of the member list, where the even spread alone would only just reach it.
  const samples = [1, 5, 60, 58];
  const { card, members } = opened(60, samples);
  assert.equal(card.chosen, SPLIT);
  assert.equal(card.expand, true);
  assert.equal(card.picks.length, EXPAND_PICKS);
  assert.deepEqual(card.picks.slice(0, samples.length), samples, "the card's own pictures come first, in order");
  assert.equal(new Set(card.picks).size, card.picks.length, "no hex twice");
  assert.ok(card.picks.every((n) => members.includes(n)));
});

test("a small card asks about every member once; a card without samples gets the plain spread", () => {
  assert.deepEqual([...opened(3, [3, 1]).card.picks].sort(), [1, 2, 3]);
  const plain = opened(40, []).card.picks;
  assert.equal(plain.length, EXPAND_PICKS);
  assert.equal(new Set(plain).size, EXPAND_PICKS);
});

test("a sample that is not a member of the card is not asked about", () => {
  assert.ok(!opened(20, [999, 4]).card.picks.includes(999));
});

test("a card of one hex is not opened, it goes back to unnamed", () => {
  const { card } = opened(1, [1]);
  assert.equal(card.chosen, "");
  assert.ok(!card.expand);
});
