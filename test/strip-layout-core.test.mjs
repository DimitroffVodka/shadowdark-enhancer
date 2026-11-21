import test from "node:test";
import assert from "node:assert/strict";
import {
  STRIP_ART, STRIP_EDGES, cardWindow, nextLiveTurn, pickStripChoice, vsGroupKey, vsTiles,
} from "../scripts/crawl-strip/strip-layout-core.mjs";

test("pickStripChoice: the GM's value wins, blank leaves it to the user", () => {
  assert.equal(pickStripChoice("left", "right", STRIP_EDGES, "top"), "left");
  assert.equal(pickStripChoice("", "right", STRIP_EDGES, "top"), "right");
  assert.equal(pickStripChoice("", "sideways", STRIP_EDGES, "top"), "top");
  assert.equal(pickStripChoice("portrait", "token", STRIP_ART, "token"), "portrait");
});

test("cardWindow: everything fits, nothing hidden", () => {
  assert.deepEqual(cardWindow({ count: 4, fit: 6, active: 2 }), { from: 0, to: 3, shift: 0 });
});

test("cardWindow: crowded, starts one before the active card", () => {
  assert.deepEqual(cardWindow({ count: 12, fit: 5, active: 6 }), { from: 5, to: 9, shift: 0 });
});

test("cardWindow: clamps at the end and hands back the clamped shift", () => {
  assert.deepEqual(cardWindow({ count: 12, fit: 5, active: 11 }), { from: 7, to: 11, shift: -3 });
  assert.deepEqual(cardWindow({ count: 12, fit: 5, active: 6, shift: 40 }), { from: 7, to: 11, shift: 2 });
  assert.deepEqual(cardWindow({ count: 12, fit: 5, active: 6, shift: -40 }), { from: 0, to: 4, shift: -5 });
});

test("cardWindow: no active card starts at the front; fit below 1 still shows one", () => {
  assert.deepEqual(cardWindow({ count: 8, fit: 3, active: -1 }), { from: 0, to: 2, shift: 0 });
  assert.deepEqual(cardWindow({ count: 8, fit: 0, active: 4 }), { from: 4, to: 4, shift: 0 });
});

const alive = (isPlayer = false) => ({ hasActor: true, isPlayer, defeated: false, hp: 5 });
const dead = () => ({ hasActor: true, isPlayer: false, defeated: true, hp: 0 });

test("nextLiveTurn: skips dead monsters and wraps into the next round", () => {
  const entries = [alive(true), dead(), alive(), dead()];
  assert.equal(nextLiveTurn(entries, 0), 2);
  assert.equal(nextLiveTurn(entries, 2), 0);
});

test("nextLiveTurn: nobody else can act, or no combat turn yet", () => {
  assert.equal(nextLiveTurn([alive(true), dead()], 0), null);
  assert.equal(nextLiveTurn([alive(), alive()], null), null);
  assert.equal(nextLiveTurn([], 0), null);
});

test("vsTiles: sides in turn order, the same monster counted once", () => {
  const { allies, enemies } = vsTiles([
    { name: "Gob", img: "g", initiative: 15, ally: false, groupKey: "gob" },
    { name: "Ana", img: "a", initiative: 12, ally: true, groupKey: null },
    { name: "Gob", img: "g", initiative: 15, ally: false, groupKey: "gob" },
    { name: "Bat", img: "b", initiative: null, ally: false, groupKey: "bat" },
  ]);
  assert.deepEqual(allies.map((t) => [t.name, t.count]), [["Ana", 1]]);
  assert.deepEqual(enemies.map((t) => [t.name, t.count, t.initiative]), [["Gob", 2, 15], ["Bat", 1, null]]);
});

test("vsGroupKey: the splash merges only the same monster on the same side and initiative", () => {
  const gob = { isPlayer: false, actorId: "gob", disposition: -1, initiative: 15 };
  assert.equal(vsGroupKey(gob), vsGroupKey({ ...gob }));
  assert.notEqual(vsGroupKey(gob), vsGroupKey({ ...gob, initiative: 8 }));
  assert.notEqual(vsGroupKey(gob), vsGroupKey({ ...gob, disposition: 1 }));
  assert.equal(vsGroupKey({ ...gob, isPlayer: true }), null);
  const { enemies } = vsTiles([
    { name: "Gob", img: "g", initiative: 15, ally: false, groupKey: vsGroupKey(gob) },
    { name: "Gob", img: "g", initiative: 8, ally: false, groupKey: vsGroupKey({ ...gob, initiative: 8 }) },
    { name: "Gob", img: "g", initiative: 15, ally: false, groupKey: vsGroupKey(gob) },
  ]);
  assert.deepEqual(enemies.map((t) => [t.initiative, t.count]), [[15, 2], [8, 1]]);
});
