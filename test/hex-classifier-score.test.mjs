import test from "node:test";
import assert from "node:assert/strict";
import { scoreClassifier } from "../scripts/hex-map/classify.mjs";

/** A labelled point whose vector is a spike at `at`, so distance is predictable. */
const pt = (num, tag, at) => {
  const vec = new Float32Array(8);
  vec[at] = 1;
  return { num, tag, vec };
};

test("scoreClassifier: leave-one-out over the GM's own tags, with the pairs it confuses", () => {
  const labelled = [
    pt(1, "ocean", 0), pt(2, "ocean", 0),
    pt(3, "forest", 4), pt(4, "forest", 4),
    pt(5, "swamp", 0),                      // sits exactly on the ocean cluster
  ];
  const { nearest, groups } = scoreClassifier(labelled);
  assert.equal(nearest.judged, 5);
  assert.equal(nearest.right, 4);
  assert.equal(nearest.accuracy, 80);
  assert.deepEqual(nearest.confusion, [["swamp→ocean", 1]]);
  assert.equal(groups, null, "no cards built, nothing to say about them");
});

test("scoreClassifier: a card holding two terrains is reported, and so is the one its core misses", () => {
  const labelled = [
    pt(10, "arctic_sea", 0), pt(11, "arctic_sea", 0), pt(12, "arctic_sea", 0),
    pt(13, "ocean", 1), pt(14, "ocean", 1),
    pt(20, "forest", 4), pt(21, "forest", 4), pt(22, "forest", 4), pt(23, "forest", 4),
  ];
  const clusters = [
    // The Western Reaches failure in miniature: one card, both water terrains,
    // and a core drawn entirely from the smaller one.
    { size: 147, members: [10, 11, 12, 13, 14], core: [13, 14] },
    { size: 40, members: [20, 21, 22, 23], core: [20, 21] },
  ];
  const { groups } = scoreClassifier(labelled, clusters);
  assert.equal(groups.cards, 2);
  assert.equal(groups.impure.length, 1, "only the mixed card");
  const bad = groups.impure[0];
  assert.equal(bad.card, 0);
  assert.equal(bad.purity, 60);
  assert.deepEqual(bad.mix, { arctic_sea: 3, ocean: 2 });
  assert.deepEqual(bad.core, { ocean: 2 });
  assert.deepEqual(bad.coreMisses, ["arctic_sea"], "naming this card cannot describe arctic sea at all");
});

test("scoreClassifier: a card too small to judge is not called impure", () => {
  const labelled = [pt(1, "ocean", 0), pt(2, "forest", 4), pt(3, "forest", 4)];
  const { groups } = scoreClassifier(labelled, [{ size: 9, members: [1, 2], core: [1] }]);
  assert.equal(groups.impure.length, 0, "two judged cells is not evidence of a mixed card");
});
