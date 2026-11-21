import test from "node:test";
import assert from "node:assert/strict";
import { mayRevealFor, shouldAutoHide } from "../scripts/crawl-strip/combat-options-core.mjs";
import { knownTo } from "../scripts/crawl-strip/turn-callouts.mjs";

const fresh = { enabled: true, monster: true, dataHidden: undefined, sourceHidden: false, tokenHidden: false };

test("shouldAutoHide: a fresh monster with the option on is auto-hidden", () => {
  assert.equal(shouldAutoHide(fresh), true);
});

test("shouldAutoHide: a monster the GM hid by hand is never flagged for auto-reveal", () => {
  assert.equal(shouldAutoHide({ ...fresh, sourceHidden: true }), false, "hidden-sync stamped _source");
  assert.equal(shouldAutoHide({ ...fresh, tokenHidden: true }), false, "its token is hidden");
  assert.equal(shouldAutoHide({ ...fresh, dataHidden: false }), false, "the create data says");
});

test("shouldAutoHide: off, or a player character, never", () => {
  assert.equal(shouldAutoHide({ ...fresh, enabled: false }), false);
  assert.equal(shouldAutoHide({ ...fresh, monster: false }), false);
});

const seen = { tokenOnMap: true, tokenHidden: false, tokenVision: true };

test("mayRevealFor: a player with a sighted token on the scene may reveal", () => {
  assert.equal(mayRevealFor({ ...seen, observers: [{ sight: true, hidden: false }] }), true);
});

test("mayRevealFor: a player with no token there, or no sight, may not", () => {
  assert.equal(mayRevealFor({ ...seen, observers: [] }), false);
  assert.equal(mayRevealFor({ ...seen, observers: [{ sight: false, hidden: false }] }), false);
  assert.equal(mayRevealFor({ ...seen, observers: [{ sight: true, hidden: true }] }), false);
});

test("mayRevealFor: without token vision any own token counts; a hidden or missing monster token never", () => {
  assert.equal(mayRevealFor({ ...seen, tokenVision: false, observers: [{ sight: false, hidden: false }] }), true);
  assert.equal(mayRevealFor({ ...seen, tokenHidden: true, observers: [{ sight: true, hidden: false }] }), false);
  assert.equal(mayRevealFor({ ...seen, tokenOnMap: false, observers: [{ sight: true, hidden: false }] }), false);
});

test("knownTo: a player knows no combatant hidden by either flag; the GM knows all", () => {
  const player = { isGM: false };
  const gm = { isGM: true };
  assert.equal(knownTo(player, { hidden: false, token: { hidden: false } }), true);
  assert.equal(knownTo(player, { hidden: true, token: { hidden: false } }), false);
  assert.equal(knownTo(player, { hidden: false, token: { hidden: true } }), false, "token hidden before hidden-sync catches up");
  assert.equal(knownTo(gm, { hidden: true, token: { hidden: true } }), true);
  assert.equal(knownTo(player, null), false);
});
