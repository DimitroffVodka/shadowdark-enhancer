import test from "node:test";
import assert from "node:assert/strict";
import { TERRAINS } from "../scripts/encounter/battle-maps/constants.mjs";
import { RAISE_WITH_PARTY_TOKEN, STAGE_PLACES, campArtFor, campTransition, normalizeStage, showCamp } from "../scripts/stage/stage-core.mjs";

const EMPTY = { shown: false, place: "", image: "", partyId: "", campId: "" };
const GOOD = { shown: true, place: "camp", image: "a.webp", partyId: "p1", campId: "c1" };

test("normalizeStage turns junk into the defaults", () => {
  for (const junk of [null, undefined, "x", 5, true, [], [GOOD]]) assert.deepEqual(normalizeStage(junk), EMPTY);
  assert.deepEqual(normalizeStage({ shown: "yes", place: "no way!", image: 3, partyId: null, campId: {} }), EMPTY);
});
test("normalizeStage keeps good values field by field and drops extras", () => {
  assert.deepEqual(normalizeStage({ ...GOOD, extra: 1 }), GOOD);
  assert.deepEqual(normalizeStage({ shown: true, place: "no where", image: "a" }), { ...EMPTY, shown: true, image: "a" });
  assert.equal(normalizeStage({ place: "Ab_c-9" }).place, "Ab_c-9");
  assert.equal(normalizeStage({ place: "x".repeat(41) }).place, "");
  assert.deepEqual(STAGE_PLACES, ["camp"]);
});

test("campArtFor gives each of the seven camps its picture", () => {
  const want = { forest: "forest-woods-camp", path: "forest-road-camp", grassland: "grassland-open-camp", jungle: "jungle-dense-camp", swamp: "swamp-bog-camp", desert: "desert-dunes-camp", salt_flat: "salt-flat-camp" };
  for (const [terrain, id] of Object.entries(want)) {
    const art = campArtFor(terrain);
    assert.equal(art.id, id, terrain);
    assert.match(art.image, new RegExp(`${id}\\.webp$`));
  }
});
test("campArtFor is null on water and falls back to the woods camp", () => {
  for (const t of ["river", "lake", "ocean", "arctic_sea"]) assert.equal(campArtFor(t), null, t);
  for (const t of ["canyon", "mountain", "coast", "volcano", "lava", "deep_tunnels", "nowhere", "", undefined, null]) assert.equal(campArtFor(t).id, "forest-woods-camp", String(t));
  assert.doesNotMatch(campArtFor("").image, /\/forest-camp\.webp$/);
});

const setup = (id = "c1") => ({ id, phase: "setup" });
const S = { partyId: "p1", image: "a.webp", partyTokenOnMap: false };
const shownCamp = { ...GOOD };

test("raise: a new camp in setup", () => {
  assert.deepEqual(campTransition(null, setup(), S), GOOD);
  assert.deepEqual(campTransition(EMPTY, setup(), S), GOOD);
});
test("no raise with a party token on the map, unless the constant is flipped", () => {
  assert.equal(RAISE_WITH_PARTY_TOKEN, false);
  const withToken = { ...S, partyTokenOnMap: true };
  assert.equal(campTransition(null, setup(), withToken), null);
  assert.deepEqual(campTransition(null, setup(), withToken, { raiseWithToken: true }), GOOD);
});
test("no raise without an image", () => {
  assert.equal(campTransition(null, setup(), { ...S, image: null }), null);
});
test("no re-raise for the same camp, in any phase or after dismissal", () => {
  for (const phase of ["setup", "firewood", "fuel", "tasks", "awaitingRest"]) {
    assert.equal(campTransition(shownCamp, { id: "c1", phase }, S), null, phase);
    assert.equal(campTransition({ ...GOOD, shown: false }, { id: "c1", phase }, S), null, `dismissed ${phase}`);
  }
  assert.equal(campTransition({ ...GOOD, shown: false }, setup(), { ...S, partyTokenOnMap: true }, { raiseWithToken: true }), null);
});
test("a second camp id raises again", () => {
  assert.deepEqual(campTransition({ ...GOOD, shown: false }, setup("c2"), S), { ...GOOD, campId: "c2" });
});
test("drop on complete or cancel, only for that camp", () => {
  assert.deepEqual(campTransition(shownCamp, { id: "c1", phase: "complete" }, S), { ...GOOD, shown: false });
  assert.deepEqual(campTransition(shownCamp, null, S), { ...GOOD, shown: false });
  assert.equal(campTransition(shownCamp, { id: "other", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, campId: "" }, null, S), null);
});
test("a GM-switched place or a hidden stage is not dropped", () => {
  assert.equal(campTransition({ ...GOOD, place: "" }, { id: "c1", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, shown: false }, { id: "c1", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, shown: false }, null, S), null);
  assert.equal(campTransition(null, null, S), null);
});
test("junk prev never throws", () => {
  assert.equal(campTransition("junk", { id: "c1", phase: "complete" }, S), null);
  assert.deepEqual(campTransition("junk", setup(), S), GOOD);
});

test("campArtFor reads the legend's own words", () => {
  assert.equal(campArtFor("Salt Flat").id, "salt-flat-camp");
  assert.equal(campArtFor(" Forest ").id, "forest-woods-camp");
  assert.equal(campArtFor("Ocean"), null);
  assert.equal(campArtFor("Arctic Sea"), null);
});
test("forest-camp is never the answer, for any shipped terrain", () => {
  for (const t of TERRAINS) {
    const art = campArtFor(t);
    if (art) assert.notEqual(art.id, "forest-camp", t);
  }
});
test("raise only in setup: a new id in any other phase does nothing", () => {
  for (const phase of ["firewood", "fuel", "tasks", "awaitingRest"]) {
    assert.equal(campTransition(null, { id: "c9", phase }, S), null, phase);
    assert.equal(campTransition(EMPTY, { id: "c9", phase }, S), null, `empty ${phase}`);
  }
  assert.equal(campTransition(EMPTY, { id: "c9", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, shown: false }, { id: "c9", phase: "complete" }, S), null);
});
test("a camp with no id never raises", () => {
  assert.equal(campTransition(null, { phase: "setup" }, S), null);
  assert.equal(campTransition({ ...GOOD, shown: false, campId: "" }, { phase: "setup" }, S), null);
  assert.equal(campTransition(null, { id: "", phase: "setup" }, S), null);
});
test("another party's camp change never drops this party's backdrop", () => {
  const B = { ...S, partyId: "pB" };
  assert.equal(campTransition(shownCamp, null, B), null);
  assert.equal(campTransition(shownCamp, { id: "c1", phase: "complete" }, B), null);
  assert.deepEqual(campTransition(shownCamp, null, S), { ...GOOD, shown: false });
});
test("showCamp writes what the raise writes, tied to a running camp only", () => {
  const args = { partyId: "p1", image: "a.webp" };
  assert.deepEqual(showCamp({ id: "c1", phase: "tasks" }, args), GOOD);
  assert.deepEqual(showCamp({ id: "c1", phase: "complete" }, args), { ...GOOD, campId: "" });
  assert.deepEqual(showCamp(null, args), { ...GOOD, campId: "" });
  assert.equal(showCamp(null, { ...args, partyId: 5 }).partyId, "");
});
