/**
 * Crawl movement anchors (movement-tracker.mjs): the turn-start spot a rollback returns a token to. They must be set
 * where the party stands, not only on the scene the GM happens to view, and cleared everywhere when a crawl ends.
 */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
globalThis.foundry = { canvas: { placeables: { tokens: { TokenRuler: class {} } } } };
globalThis._del = Symbol("del");

const token = (id, actorId, flags = {}) => {
  const doc = { id, actorId, x: 0, y: 0, flags: { [MOD]: { ...flags } }, updates: [] };
  doc.update = async (changes) => { doc.updates.push(changes); };
  return doc;
};
const scene = (id, tokens) => ({ id, tokens: Object.assign([...tokens], { contents: tokens }) });

const { MovementTracker } = await import("../scripts/crawl-strip/movement-tracker.mjs");
const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");
CrawlStrip.queueRender = () => {};

test("a crawl turn anchors the party on the active scene, even with no canvas (the Bridge)", async () => {
  const onMap = token("t1", "pc1"), elsewhere = token("t2", "pc1");
  globalThis.canvas = { scene: null };
  globalThis.game = { user: { isGM: true }, scenes: { active: scene("B", [onMap]), contents: [] } };
  const reset = [];
  MovementTracker.resetToken = async (doc) => { reset.push(doc.id); };
  await MovementTracker.resetCrawl(["pc1"]);
  assert.deepEqual(reset, ["t1"]);
  assert.equal(elsewhere.updates.length, 0);
});

test("ending a crawl clears every anchor on every scene, and leaves other tokens alone", async () => {
  const viewed = token("a1", "pc1", { turnStart: { x: 1, y: 1 } });
  const other = token("b1", "pc2", { moveRemaining: 30, turnStart: { x: 5, y: 5 } });
  const plain = token("b2", "npc");
  const A = scene("A", [viewed]), B = scene("B", [other, plain]);
  globalThis.canvas = { scene: A };
  globalThis.game = { user: { isGM: true }, scenes: { active: A, contents: [A, B] } };
  await MovementTracker.clearCrawlAnchors();
  assert.equal(viewed.updates.length, 1);
  assert.equal(other.updates.length, 1, "the map the GM was not viewing is cleared too");
  assert.equal(plain.updates.length, 0, "a token with no anchor is not written");
});
