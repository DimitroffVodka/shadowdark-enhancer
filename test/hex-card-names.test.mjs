import test from "node:test";
import assert from "node:assert/strict";
import { suspectCardNames, SUSPECT_RATIO } from "../scripts/hex-map/legend.mjs";

const at = (...xs) => Float32Array.from(xs);
/** Three jungle-ish cards together, two desert-ish cards far away. */
const cards = (nameOfFirstDesert) => [
  { idx: 0, name: nameOfFirstDesert, size: 390, centroid: at(10, 0) },   // really desert
  { idx: 1, name: "desert", size: 35, centroid: at(10.05, 0) },
  { idx: 2, name: "jungle", size: 189, centroid: at(0, 0) },
  { idx: 3, name: "jungle", size: 180, centroid: at(0.2, 0) },
  { idx: 4, name: "jungle", size: 29, centroid: at(0.1, 0.1) },
];

test("suspectCardNames: a card named like the wrong family is caught", () => {
  const found = suspectCardNames(cards("jungle"));
  assert.equal(found.length, 1);
  assert.equal(found[0].idx, 0);
  assert.equal(found[0].name, "jungle");
  assert.equal(found[0].looksLike, "desert");
  assert.equal(found[0].size, 390, "the big ones are reported first, because they cost the most");
  assert.ok(found[0].times >= SUSPECT_RATIO, "and by a wide margin, which is why the bar can be set high");
});

test("suspectCardNames: the bar is where the false alarms stopped on a real map", () => {
  assert.equal(SUSPECT_RATIO, 8, "2 cried wolf four times on a correctly named map, 8 not at all");
  // A card only a little closer to another name is an honest near-miss, not a slip.
  const near = [
    { idx: 0, name: "forest", size: 128, centroid: at(0, 0) },
    { idx: 1, name: "forest", size: 90, centroid: at(3, 0) },
    { idx: 2, name: "mountain", size: 85, centroid: at(1.4, 0) },
    { idx: 3, name: "mountain", size: 60, centroid: at(1.5, 0) },
  ];
  assert.deepEqual(suspectCardNames(near), [], "4x closer is not enough to question a name");
});

test("suspectCardNames: the same cards named correctly raise nothing", () => {
  assert.deepEqual(suspectCardNames(cards("desert")), []);
});

test("suspectCardNames: a terrain with one card has nothing to be consistent with", () => {
  const lone = [
    { idx: 0, name: "canyon", size: 22, centroid: at(10, 0) },
    { idx: 1, name: "jungle", size: 180, centroid: at(10.1, 0) },
    { idx: 2, name: "jungle", size: 29, centroid: at(0, 0) },
  ];
  const found = suspectCardNames(lone);
  assert.equal(found.some((f) => f.name === "canyon"), false, "one canyon card cannot disagree with itself");
});

test("suspectCardNames: unnamed and centroid-less cards are skipped, not crashed on", () => {
  assert.deepEqual(suspectCardNames([{ idx: 0, name: "", size: 9 }, { idx: 1, name: "forest", size: 9 }]), []);
  assert.deepEqual(suspectCardNames([]), []);
});
