import test from "node:test";
import assert from "node:assert/strict";
import { parseSiegeWeapons, SIEGE_MANIFEST } from "../scripts/importer/boats/siege-parser.mjs";

// Real names (needed for matching) + made-up stats + short property blurbs.
const SPLIT = `
Weapon Cost
Ballista 99 gp
Trebuchet 222 gp
Blast (B). Fake blast blurb
over two lines.
SIEGE WEAPONS
Type Range Damage Properties
R F 1d6 E
M N 2d10 B, E
Exploding (E). Fake exploding blurb.
`;

test("parseSiegeWeapons returns the weapons plus one ammunition item", () => {
  const out = parseSiegeWeapons(SPLIT);
  assert.deepEqual(out.map((x) => x.name), ["Ballista", "Trebuchet", "Siege Weapon Ammunition"]);
});

test("weapon drafts map the stat columns", () => {
  const [b] = parseSiegeWeapons(SPLIT);
  assert.equal(b.type, "Weapon");
  assert.equal(b.cost.gp, 99);
  assert.equal(b.wtype, "ranged");
  assert.equal(b.range, "far");
  assert.equal(b.damage.oneHanded, "d6");                             // base die for the SD field
  assert.equal(b.flags["shadowdark-enhancer"].siegeDamage, "1d6");    // full formula kept in a flag
  assert.equal(b.flags["shadowdark-enhancer"].siegeWeapon, true);     // classifies onto the Weapons tab
  assert.equal(b.slots.slots_used, 30);
  assert.equal(b.ammoClass, "Siege Weapon Ammunition");
});

// Whole-row paste (no split header): `<Name> <cost> gp <Type> <Range> <dmg> <props>`.
const WHOLE = `
Ballista 42 gp R F 1d6 E
Trebuchet 99 gp M N 2d10 B, E
Blast (B). Fake blast blurb.
Exploding (E). Fake exploding blurb.
`;

test("parseSiegeWeapons handles the whole-row fallback layout", () => {
  const out = parseSiegeWeapons(WHOLE);
  assert.deepEqual(out.map((x) => x.name), ["Ballista", "Trebuchet", "Siege Weapon Ammunition"]);
});

test("whole-row drafts map every stat column (incl. melee/near codes)", () => {
  const [ballista, treb] = parseSiegeWeapons(WHOLE);
  assert.equal(ballista.cost.gp, 42);
  assert.equal(ballista.wtype, "ranged");
  assert.equal(ballista.range, "far");
  assert.equal(ballista.damage.oneHanded, "d6");
  assert.equal(ballista.flags["shadowdark-enhancer"].siegeDamage, "1d6");
  assert.deepEqual(ballista.siegeProperties.map((p) => p.name), ["Exploding"]);
  // Trebuchet row uses the M/N codes → melee/near, and the multi-token props "B, E".
  assert.equal(treb.wtype, "melee");
  assert.equal(treb.range, "near");
  assert.equal(treb.damage.oneHanded, "d10");
  assert.equal(treb.flags["shadowdark-enhancer"].siegeDamage, "2d10");
  assert.deepEqual(treb.siegeProperties.map((p) => p.name), ["Blast", "Exploding"]);
});

test("whole-row fallback de-dupes a repeated weapon row", () => {
  const dup = `${WHOLE}\nBallista 42 gp R F 1d6 E`;
  const names = parseSiegeWeapons(dup).map((x) => x.name);
  assert.equal(names.filter((n) => n === "Ballista").length, 1);
});

test("Blast/Exploding become siegeProperties with descriptions parsed off the page", () => {
  const [ballista, treb] = parseSiegeWeapons(SPLIT);
  assert.deepEqual(ballista.siegeProperties.map((p) => p.name), ["Exploding"]);
  assert.match(ballista.siegeProperties[0].description, /exploding blurb/i);
  assert.deepEqual(treb.siegeProperties.map((p) => p.name), ["Blast", "Exploding"]);
  assert.match(treb.siegeProperties.find((p) => p.name === "Blast").description, /blast blurb/i);
});

test("the ammunition item is a Basic ammo item, 1 gp / 2 slots", () => {
  const ammo = parseSiegeWeapons(SPLIT).at(-1);
  assert.equal(ammo.name, "Siege Weapon Ammunition");
  assert.equal(ammo.type, "Basic");
  assert.equal(ammo.isAmmunition, true);
  assert.equal(ammo.cost.gp, 1);
  assert.equal(ammo.slots.slots_used, 2);
});

test("no weapons parsed → empty (no orphan ammunition)", () => {
  assert.deepEqual(parseSiegeWeapons("just prose, no table"), []);
});

test("SIEGE_MANIFEST is names + source only", () => {
  assert.equal(SIEGE_MANIFEST.length, 4);
  for (const s of SIEGE_MANIFEST) {
    assert.deepEqual(Object.keys(s).sort(), ["name", "page", "src"]);
    assert.equal(s.src, "WR");
    assert.equal(s.page, "119");
  }
});
