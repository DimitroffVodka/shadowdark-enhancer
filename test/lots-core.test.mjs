import test from "node:test";
import assert from "node:assert/strict";
import { addLot, takeLot, lotsOf, lotsPath, MAX_LOTS } from "../scripts/merchant/lots-core.mjs";

const lot = (id) => ({ id, name: id, img: "", qty: 1, copper: 10, data: {} });

test("addLot keeps the newest ten and never changes its input", () => {
  let lots = [];
  for (let i = 1; i <= 12; i++) lots = addLot(lots, lot(`l${i}`));
  assert.equal(lots.length, MAX_LOTS);
  assert.deepEqual([lots[0].id, lots.at(-1).id], ["l3", "l12"]);
  const before = [lot("a")];
  addLot(before, lot("b"));
  assert.equal(before.length, 1);
});

test("takeLot removes one lot and leaves the rest", () => {
  const lots = [lot("a"), lot("b")];
  assert.deepEqual(takeLot(lots, "a").map((l) => l.id), ["b"]);
  assert.equal(takeLot(lots, "zz").length, 2);
});

test("lotsOf reads a character's lots for one merchant, ignoring junk", () => {
  const actor = { flags: { "shadowdark-enhancer": { shopLots: { m1: [lot("a"), null, { name: "no id" }], m2: "bad" } } } };
  assert.deepEqual(lotsOf(actor, { id: "m1" }).map((l) => l.id), ["a"]);
  assert.deepEqual(lotsOf(actor, { id: "m2" }), []);
  assert.deepEqual(lotsOf(actor, { id: "m3" }), []);
});

test("lotsPath refuses an id that cannot be a key", () => {
  assert.equal(lotsPath({ id: "m1" }), "flags.shadowdark-enhancer.shopLots.m1");
  assert.throws(() => lotsPath({ id: "a.b" }));
});
