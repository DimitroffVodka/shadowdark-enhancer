/**
 * Trap events reach every client that applies the token update. Only the active GM's
 * working tab may act on them, or a GM signed in twice gets two cards and a `holds`
 * trap deals its damage once per tab (PR #399 review).
 */
import test from "node:test";
import assert from "node:assert/strict";

const cards = [];
globalThis.ChatMessage = { create: async (data) => { cards.push(data); } };
globalThis.Roll = class { async evaluate() { return { total: 1 }; } };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  user: { id: "gm1", isGM: true },
  users: { activeGM: { id: "gm1" } },
};

const { onTokenMoveIn, onTokenRound } = await import("../scripts/traps/traps.mjs");

const trap = () => ({
  trap: "Pit", trigger: "Step", effect: "Fall", damage: "", checkAbility: "none", checkDc: 12,
  when: "enter", holds: false, resets: true, sprung: false, chance: "", parent: { id: "b1", update: async () => {} },
});
const event = { data: { token: { name: "Ayla", actor: null, document: { uuid: "t" } } } };

test("a GM who is not the active GM does nothing on a move in, or on a round", async () => {
  cards.length = 0;
  globalThis.game.users.activeGM = { id: "gm2" };
  await onTokenMoveIn.call(trap(), event);
  await onTokenRound.call({ ...trap(), when: "round" }, event);
  assert.equal(cards.length, 0);
});

test("the active GM posts exactly one card for a move in", async () => {
  cards.length = 0;
  globalThis.game.users.activeGM = { id: "gm1" };
  await onTokenMoveIn.call(trap(), event);
  assert.equal(cards.length, 1);
});

test("a fires-once trap entered by a group at once posts one card, not one per token", async () => {
  cards.length = 0;
  const once = { ...trap(), resets: false, parent: { id: "b2", uuid: "Scene.s.Region.r.RegionBehavior.b2" } };
  once.parent.update = async () => { await new Promise((resolve) => setTimeout(resolve, 5)); once.sprung = true; };
  await Promise.all([1, 2, 3].map(() => onTokenMoveIn.call(once, event)));
  assert.equal(cards.length, 1);
  assert.equal(once.sprung, true);
  await onTokenMoveIn.call(once, event);
  assert.equal(cards.length, 1, "once sprung, it stays quiet");
});

test("a player never acts, even when the GM seat is theirs to read", async () => {
  cards.length = 0;
  globalThis.game.user = { id: "p1", isGM: false };
  globalThis.game.users.activeGM = { id: "p1" };
  await onTokenMoveIn.call(trap(), event);
  assert.equal(cards.length, 0);
});
