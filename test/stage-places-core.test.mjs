import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PLACES, PLACE_KINDS, addPlace, fitWithin, normalizePlaces, placeById, removePlace, reshowTarget, updatePlace, uploadName } from "../scripts/stage/places-core.mjs";

const P = (id, extra = {}) => ({ id, kind: "town", name: `Place ${id}`, image: `${id}.webp`, ...extra });

test("kinds are the four labels", () => assert.deepEqual(PLACE_KINDS, ["town", "tavern", "camp", "custom"]));

test("normalizePlaces never throws and turns junk into an empty list", () => {
  for (const junk of [null, undefined, "x", 5, [], {}, { places: "no" }, { places: [null, 3, "x", {}] }]) assert.deepEqual(normalizePlaces(junk), { places: [] });
});
test("normalizePlaces drops bad ids, missing images, duplicates and the reserved camp id", () => {
  const out = normalizePlaces({ places: [P("a"), P("a", { image: "other" }), P("b c"), P("d", { image: "" }), P("e", { image: 4 }), { image: "x" }, P("camp"), P("f")] });
  assert.deepEqual(out.places.map((p) => p.id), ["a", "f"]);
  assert.equal(out.places[0].image, "a.webp");
});
test("normalizePlaces trims and clamps the name, and unknown kinds become custom", () => {
  const [p] = normalizePlaces({ places: [P("a", { name: `${"n".repeat(80)}  `, kind: "castle" })] }).places;
  assert.equal(p.name, "n".repeat(60));
  assert.equal(p.kind, "custom");
  assert.equal(normalizePlaces({ places: [P("a", { name: 5 })] }).places[0].name, "");
});
test("the list is capped at MAX_PLACES", () => {
  assert.equal(MAX_PLACES, 24);
  const many = Array.from({ length: 40 }, (_, i) => P(`p${i}`));
  const out = normalizePlaces({ places: many });
  assert.equal(out.places.length, 24);
  assert.equal(out.places[23].id, "p23");
  assert.deepEqual(addPlace(out, P("extra")), out);
});
test("add, update, remove and lookup return new normalized values", () => {
  const a = addPlace(null, P("a"));
  const b = addPlace(a, P("b"));
  assert.deepEqual(a.places.map((p) => p.id), ["a"]);
  assert.deepEqual(b.places.map((p) => p.id), ["a", "b"]);
  assert.deepEqual(addPlace(b, P("a")).places.map((p) => p.id), ["a", "b"]);
  assert.equal(placeById(b, "b").id, "b");
  assert.equal(placeById(b, "zz"), null);
  const u = updatePlace(b, "a", { name: "New", kind: "tavern", image: "n.webp", id: "hack", extra: 1 });
  assert.deepEqual(u.places[0], { id: "a", kind: "tavern", name: "New", image: "n.webp" });
  assert.deepEqual(updatePlace(b, "a", { image: "" }), removePlace(b, "a")); // an emptied picture drops the place
  assert.deepEqual(updatePlace(b, "zz", { name: "x" }), b);
  assert.deepEqual(removePlace(b, "a").places.map((p) => p.id), ["b"]);
  assert.equal(b.places.length, 2);
});
test("fitWithin scales to the longest edge, never upscales, keeps integers of at least 1", () => {
  assert.deepEqual(fitWithin(5000, 3000, 2560), { width: 2560, height: 1536 });
  assert.deepEqual(fitWithin(3000, 5000, 2560), { width: 1536, height: 2560 });
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 2560), { width: 2560, height: 1 });
});
test("uploadName makes a lowercase slug, caps it at 40, defaults to place", () => {
  assert.equal(uploadName("The Gilded Boar!", "ab12cd"), "the-gilded-boar-ab12cd.webp");
  assert.equal(uploadName("  ", "x1"), "place-x1.webp");
  assert.equal(uploadName("日本", "x1"), "place-x1.webp");
  assert.equal(uploadName(undefined, "x1"), "place-x1.webp");
  const long = uploadName("a".repeat(100), "r");
  assert.equal(long, `${"a".repeat(40)}-r.webp`);
  assert.match(uploadName("A b/C..d", "r"), /^[a-z0-9-]+\.webp$/);
});
test("reshowTarget returns a custom place that still exists, whatever its picture now is", () => {
  const list = { places: [P("a")] };
  const hidden = { shown: false, place: "a", image: "a.webp" };
  assert.equal(reshowTarget(hidden, list).id, "a");
  assert.equal(reshowTarget({ ...hidden, shown: true }, list), null);
  assert.equal(reshowTarget({ ...hidden, place: "camp" }, list), null);
  assert.equal(reshowTarget({ ...hidden, place: "" }, list), null);
  assert.equal(reshowTarget({ ...hidden, place: "gone" }, list), null);
  assert.equal(reshowTarget({ ...hidden, image: "old.webp" }, list).id, "a");
  assert.equal(reshowTarget(null, list), null);
});
test("normalizePlaces cuts the name at 60 code points, then trims", () => {
  assert.equal(normalizePlaces({ places: [P("a", { name: `${"n".repeat(59)} tail` })] }).places[0].name, "n".repeat(59));
  assert.equal(normalizePlaces({ places: [P("a", { name: "\u{1F417}".repeat(70) })] }).places[0].name, "\u{1F417}".repeat(60));
});
test("normalizePlaces trims leading spaces before cutting, so they do not eat into the 60", () => {
  assert.equal(normalizePlaces({ places: [P("a", { name: `   ${"n".repeat(60)}` })] }).places[0].name, "n".repeat(60));
});
test("fitWithin gives 1 by 1 for non-finite or non-positive input", () => {
  for (const a of [[NaN, 5, 10], [5, 0, 10], [-3, 5, 10], [Infinity, 5, 10], [5, 5, 0]]) assert.deepEqual(fitWithin(...a), { width: 1, height: 1 });
});
