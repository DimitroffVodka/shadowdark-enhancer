// A4 — the generic curated-icon resolver.
//
// Covers the mechanism only: the one normalization, the two key spaces and the
// contract that keeps them apart, map validation and its drift reporting, the
// base-system write guard, and the A3 provenance state a curated pick carries.
//
// Every map here is a FIXTURE. Whether the reviewed rows ship with the resolver
// or with each consuming ticket is an open program-scope decision, so nothing
// in this file asserts a census or imports a shipped map — these tests hold
// whichever way that lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { ART_STATES, classifyArt, isArtUpgradeable } from "../scripts/shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  curatedNameKey,
  curatedSourcedKey,
  defineCuratedIconMap,
  registerCuratedIconMap,
  curatedIconRegistry,
  buildCuratedIconRegistry,
  EMPTY_CURATED_ICON_REGISTRY,
  resolveCuratedIcon,
  curatedArtFor,
  isCuratedApplyTarget,
  auditCuratedIconRegistry,
  _resetCuratedIconMaps,
} from "../scripts/shared/curated-icons.mjs";
import { buildItemData, defaultItemImg, preserveCuratedFields } from "../scripts/importer/items/item-importer.mjs";

const BLADE = "icons/weapons/swords/sword-guard.webp";
const ROPE = "icons/sundries/survival/rope-coiled-brown.webp";
const PUTTY = "icons/commodities/materials/slime-brown.webp";
const MIRROR = "icons/sundries/survival/mirror-plain.webp";
const LAMP = "icons/commodities/treasure/brass-lamp-yellow.webp";

/** A bare-space fixture whose names carry the punctuation real gear names do. */
const gearFixture = () => defineCuratedIconMap("gear-fixture", {
  "Bastard sword": BLADE,
  "Rope, 60'": ROPE,
  "Miner's putty, jar": PUTTY,
  "Mirror": MIRROR,
}, { space: CURATED_KEY_SPACES.BARE });

/** A sourced-space fixture spanning two books. */
const treasureFixture = () => defineCuratedIconMap("treasure-fixture", {
  cs2: { "Tarnished, bronze oil lamp": LAMP, "Cracked mirror": MIRROR },
  cs1: { "Cracked mirror": PUTTY },
}, { space: CURATED_KEY_SPACES.SOURCED });

// ── normalization ────────────────────────────────────────────────────────────

test("curatedNameKey folds case and whitespace and nothing else", () => {
  assert.equal(curatedNameKey("Bastard Sword"), "bastard sword");
  assert.equal(curatedNameKey("  BASTARD   sword \n"), "bastard sword");
  assert.equal(curatedNameKey("Spear-thrower"), "spear-thrower");
});

test("curatedNameKey preserves the punctuation that distinguishes real names", () => {
  // Commas, apostrophes, primes and parenthesised quantities are all load-bearing:
  // the maps carry `Arrows` and `Arrows (20)` as separate rows, and
  // `Chainmail, mithral` must not collapse onto `Chainmail`.
  assert.equal(curatedNameKey("Rope, 60'"), "rope, 60'");
  assert.equal(curatedNameKey("Thieves' Tools"), "thieves' tools");
  assert.equal(curatedNameKey("Arrows (20)"), "arrows (20)");
  assert.notEqual(curatedNameKey("Arrows (20)"), curatedNameKey("Arrows"));
  assert.notEqual(curatedNameKey("Chainmail, mithral"), curatedNameKey("Chainmail"));
});

test("curatedNameKey folds curly quotes to ASCII", () => {
  // pdf-text-utils already does this upstream, but a hand-pasted name never
  // passes through it and would silently miss every possessive gear entry.
  assert.equal(curatedNameKey("Miner’s putty, jar"), "miner's putty, jar");
  assert.equal(curatedNameKey("Traveler‘s lamp"), "traveler's lamp");
});

test("curatedNameKey is idempotent and total", () => {
  const once = curatedNameKey("  Miner’s Putty,  Jar ");
  assert.equal(curatedNameKey(once), once);
  for (const empty of [null, undefined, "", "   "]) assert.equal(curatedNameKey(empty), "");
});

test("curatedSourcedKey canonicalizes every spelling of a book", () => {
  const expected = "cs3:a golden skull studded with small sapphires";
  for (const spelling of ["cs3", "CS3", "Cursed Scroll 3", "Cursed Scroll #3", "Midnight Sun"]) {
    assert.equal(curatedSourcedKey(spelling, "A golden skull studded with small sapphires"), expected, spelling);
  }
  // Both Western Reaches guides are one book.
  assert.equal(curatedSourcedKey("pgwr", "Net"), curatedSourcedKey("Western Reaches", "Net"));
  // Either half missing yields no key at all.
  assert.equal(curatedSourcedKey("", "Net"), "");
  assert.equal(curatedSourcedKey("cs3", "  "), "");
});

// ── map definition and drift ─────────────────────────────────────────────────

test("defineCuratedIconMap derives keys from display names", () => {
  const map = gearFixture();
  assert.deepEqual(map.problems, []);
  assert.equal(map.entries.get("bastard sword"), BLADE);
  assert.equal(map.entries.get("miner's putty, jar"), PUTTY);
  assert.equal(map.space, CURATED_KEY_SPACES.BARE);
});

test("defineCuratedIconMap nests the sourced space by book", () => {
  const map = treasureFixture();
  assert.deepEqual(map.problems, []);
  assert.equal(map.entries.get("cs2:tarnished, bronze oil lamp"), LAMP);
  // The same name in two books is two distinct entries — the whole point.
  assert.equal(map.entries.get("cs2:cracked mirror"), MIRROR);
  assert.equal(map.entries.get("cs1:cracked mirror"), PUTTY);
});

test("a duplicate key keeps the first row and records the loser", () => {
  const map = defineCuratedIconMap("dupes", {
    "Mirror": MIRROR,
    "  mirror  ": PUTTY,   // same key after normalization
  }, { space: CURATED_KEY_SPACES.BARE });
  assert.equal(map.entries.get("mirror"), MIRROR);
  assert.equal(map.entries.size, 1);
  assert.equal(map.problems.length, 1);
  assert.equal(map.problems[0].kind, "duplicate-key");
  assert.equal(map.problems[0].map, "dupes");
});

test("a path that is not a native icons/**.webp is dropped and reported", () => {
  const map = defineCuratedIconMap("paths", {
    "Good": BLADE,
    "Wrong tree": "modules/shadowdark-enhancer/assets/icons/shikashi/dagger.webp",
    "Wrong format": "icons/weapons/swords/sword-guard.png",
    "Blank": "",
  }, { space: CURATED_KEY_SPACES.BARE });
  assert.equal(map.entries.size, 1);
  assert.equal(map.entries.get("good"), BLADE);
  assert.equal(map.problems.length, 3);
  assert.ok(map.problems.every((p) => p.kind === "malformed-path"));
});

test("map construction is total — bad input never throws", () => {
  assert.doesNotThrow(() => defineCuratedIconMap("junk", null, { space: "nonsense" }));
  const map = defineCuratedIconMap("junk", { "   ": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  assert.equal(map.entries.size, 0);
  assert.equal(map.problems[0].kind, "unusable-name");

  const sourced = defineCuratedIconMap("junk", { "": { "Net": BLADE } }, { space: CURATED_KEY_SPACES.SOURCED });
  assert.equal(sourced.entries.size, 0);
  assert.equal(sourced.problems[0].kind, "unusable-source");
});

test("the bare space is shared, so a name claimed by two maps is a cross-map collision", () => {
  // This is the check that enforces "gear names are globally distinct": neither
  // map is internally inconsistent, and only the merge can see the clash.
  const weapons = defineCuratedIconMap("weapons", { "Mirror": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  const registry = buildCuratedIconRegistry([weapons, gearFixture()]);
  const clash = registry.problems.filter((p) => p.kind === "duplicate-key");
  assert.equal(clash.length, 1);
  assert.ok(clash[0].detail.startsWith("mirror"));
  assert.equal(registry.bare.get("mirror"), BLADE, "first map wins, deterministically");
});

test("the sourced space does not collide across books", () => {
  const registry = buildCuratedIconRegistry([treasureFixture()]);
  assert.deepEqual(registry.problems, []);
  assert.equal(registry.sourced.size, 3);
});

// ── lookup ───────────────────────────────────────────────────────────────────

test("a sourceless lookup reads the bare space", () => {
  const registry = buildCuratedIconRegistry([gearFixture()]);
  assert.equal(resolveCuratedIcon({ name: "Bastard Sword" }, registry), BLADE);
  assert.equal(resolveCuratedIcon({ name: "  rope,   60'  " }, registry), ROPE);
});

test("a bare-space entry is source-agnostic", () => {
  // The 94 gear names resolve identically whichever book printed them — this is
  // why the item-construction choke point can resolve them without a source.
  const registry = buildCuratedIconRegistry([gearFixture()]);
  for (const source of [undefined, "", "core", "Western Reaches", "Cursed Scroll #3", "Some GM's Homebrew"]) {
    assert.equal(resolveCuratedIcon({ name: "Bastard sword", source }, registry), BLADE, String(source));
  }
});

test("a treasure lookup needs its book and gets the right one", () => {
  const registry = buildCuratedIconRegistry([treasureFixture()]);
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror", source: "cs2" }, registry), MIRROR);
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror", source: "Diablerie" }, registry), PUTTY);
  // Without the book the sourced space is unreachable — by design, not by accident.
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror" }, registry), null);
  // A book that has no entry for the name does not borrow another book's.
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror", source: "cs6" }, registry), null);
});

test("a qualified entry outranks a bare one of the same name", () => {
  const registry = buildCuratedIconRegistry([gearFixture(), treasureFixture()]);
  const bare = defineCuratedIconMap("b", { "Cracked mirror": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  const both = buildCuratedIconRegistry([bare, treasureFixture()]);
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror", source: "cs2" }, both), MIRROR);
  // …and falls back to the bare space when that book has no opinion.
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror", source: "cs6" }, both), BLADE);
  assert.equal(resolveCuratedIcon({ name: "Mirror", source: "cs2" }, registry), MIRROR);
});

test("an unmatched name degrades to null rather than guessing", () => {
  const registry = buildCuratedIconRegistry([gearFixture(), treasureFixture()]);
  for (const name of ["Vorpal Sword", "sword", "Bastard", "", null, undefined]) {
    assert.equal(resolveCuratedIcon({ name }, registry), null, String(name));
  }
  // A near-miss is still a miss: no substring or fuzzy tier exists on purpose.
  assert.equal(resolveCuratedIcon({ name: "Bastard sword +1" }, registry), null);
});

test("the empty registry answers null for everything without failing", () => {
  assert.equal(resolveCuratedIcon({ name: "Bastard sword" }), null);
  assert.equal(resolveCuratedIcon({ name: "Cracked mirror", source: "cs2" }, EMPTY_CURATED_ICON_REGISTRY), null);
  assert.equal(curatedArtFor({ name: "Bastard sword" }), null);
  assert.deepEqual(auditCuratedIconRegistry().problems, []);
  assert.equal(auditCuratedIconRegistry().total, 0);
});

// ── provenance and the write guard ───────────────────────────────────────────

test("curatedArtFor returns the pick together with its A3 state", () => {
  const registry = buildCuratedIconRegistry([gearFixture()]);
  assert.deepEqual(curatedArtFor({ name: "Bastard sword" }, registry), { img: BLADE, artState: ART_STATES.CURATED });
  assert.equal(curatedArtFor({ name: "Vorpal Sword" }, registry), null);
});

test("the curated state is one A3 will upgrade rather than freeze", () => {
  // An image written without its `curated` stamp reads as GM art on the next
  // import and can never be upgraded again — so the state must be exactly this.
  const registry = buildCuratedIconRegistry([gearFixture()]);
  assert.equal(curatedArtFor({ name: "Mirror" }, registry).artState, ART_STATES.CURATED);
  assert.notEqual(ART_STATES.CURATED, ART_STATES.CUSTOM);
});

test("curated art may be written to world packs and never to the base system", () => {
  assert.equal(isCuratedApplyTarget("world.shadowdark-enhancer--items"), true);
  assert.equal(isCuratedApplyTarget("world.classes"), true);
  for (const denied of [
    "shadowdark.gear",             // the pack the acceptance criterion names
    "shadowdark.magic-items",
    "shadowdark.monsters",
    "modules.some-other-module.items",
    "", "   ", null, undefined,
  ]) {
    assert.equal(isCuratedApplyTarget(denied), false, String(denied));
  }
});

// ── audit ────────────────────────────────────────────────────────────────────

test("the audit counts both spaces and surfaces every dropped row", () => {
  const broken = defineCuratedIconMap("broken", { "Bad": "nope.png" }, { space: CURATED_KEY_SPACES.BARE });
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([gearFixture(), treasureFixture(), broken]));
  assert.equal(report.bare, 4);
  assert.equal(report.sourced, 3);
  assert.equal(report.total, 7);
  assert.equal(report.problems.length, 1);
  assert.equal(report.problems[0].kind, "malformed-path");
  assert.deepEqual(report.perMap.map((m) => m.label), ["gear-fixture", "treasure-fixture", "broken"]);
});

test("a clean registry reports no problems, which is the drift gate", () => {
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([gearFixture(), treasureFixture()]));
  assert.deepEqual(report.problems, []);
});

test("a name living in both spaces is reported as informational, not a problem", () => {
  // Qualified-wins makes this resolvable, so it is counted rather than failed.
  const bare = defineCuratedIconMap("b", { "Cracked mirror": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([bare, treasureFixture()]));
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.crossSpaceNames, ["cracked mirror"]);
});

// ── discovery-based registration ─────────────────────────────────────────────
//
// Maps publish themselves at import time so no two tickets edit one shared
// list. These cases drive that API directly; a real data module differs only in
// being loaded by the side-effect index.

test("no map is registered until one ships", () => {
  _resetCuratedIconMaps();
  const report = auditCuratedIconRegistry();
  assert.equal(report.total, 0);
  assert.deepEqual(report.perMap, []);
  assert.deepEqual(report.problems, []);
});

test("registering a map publishes it to the live registry", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();

  assert.equal(resolveCuratedIcon({ name: "Bastard sword" }), null);
  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  assert.equal(resolveCuratedIcon({ name: "Bastard sword" }), BLADE);

  // A second map lands in the same spaces — registration order is the merge order.
  registerCuratedIconMap("plunder", { cs2: { "Tarnished, bronze oil lamp": LAMP } }, { space: CURATED_KEY_SPACES.SOURCED });
  assert.equal(resolveCuratedIcon({ name: "Tarnished, bronze oil lamp", source: "Cursed Scroll #2" }), LAMP);
  assert.equal(auditCuratedIconRegistry().total, 2);
  assert.deepEqual(auditCuratedIconRegistry().perMap.map((m) => m.label), ["weapons", "plunder"]);
});

test("the memoized registry is invalidated by a later registration", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  const before = curatedIconRegistry();
  assert.equal(before.bare.size, 0);
  registerCuratedIconMap("late", { "Mirror": MIRROR }, { space: CURATED_KEY_SPACES.BARE });
  assert.notEqual(curatedIconRegistry(), before);
  assert.equal(curatedIconRegistry().bare.get("mirror"), MIRROR);
});

test("a registered map's drift reaches the registry-wide audit", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  registerCuratedIconMap("bad", { "Broken": "icons/weapons/swords/sword.png" }, { space: CURATED_KEY_SPACES.BARE });
  const report = auditCuratedIconRegistry();
  assert.equal(report.total, 0, "the bad row is dropped, not published");
  assert.equal(report.problems.length, 1);
  assert.equal(report.problems[0].kind, "malformed-path");
  assert.equal(resolveCuratedIcon({ name: "Broken" }), null, "and the item falls back");
});

// ── the shared wiring ────────────────────────────────────────────────────────

test("with no maps registered, defaultItemImg is byte-identical to before A4", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  // The A4 hook must be completely inert until a map ships — this is what lets
  // test/art-provenance.test.mjs pass unmodified. These are the pre-A4 answers.
  assert.equal(defaultItemImg({ name: "Anything", type: "Background" }), "icons/environment/people/commoner.webp");
  assert.equal(defaultItemImg({ name: "Anything", type: "Class" }), "icons/skills/trades/academics-book-study-runes.webp");
  assert.ok(defaultItemImg({ name: "Bastard sword", type: "Weapon" }), "the keyword chain still answers");
  assert.notEqual(defaultItemImg({ name: "Bastard sword", type: "Weapon" }), BLADE);
});

test("defaultItemImg prefers a curated pick over the broad keyword fallback", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();

  // Capture the pre-registration answers first — afterwards the registry is live.
  const swordFallback = defaultItemImg({ name: "Bastard sword", type: "Weapon" });
  const vorpalFallback = defaultItemImg({ name: "Vorpal Sword", type: "Weapon" });
  assert.notEqual(swordFallback, BLADE, "fixture must actually differ from the fallback");

  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });

  assert.equal(defaultItemImg({ name: "Bastard sword", type: "Weapon" }), BLADE);
  // Case and spacing reach the same entry.
  assert.equal(defaultItemImg({ name: "  BASTARD   SWORD ", type: "Weapon" }), BLADE);
  // An unmapped name is untouched by the hook.
  assert.equal(defaultItemImg({ name: "Vorpal Sword", type: "Weapon" }), vorpalFallback);
});

test("a map hit stamps curated, because that is what the state means", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });

  // A3 defines `curated` as "a deliberate module icon pick (A4)". A reviewed
  // map hit IS that, whether a consumer asked for it by name or the shared
  // seam resolved it — so the stamp must record the map origin truthfully.
  const data = buildItemData({ name: "Bastard sword", type: "Weapon" });
  assert.equal(data.img, BLADE);
  assert.equal(data.flags[MODULE_ID].art.state, ART_STATES.CURATED);
  assert.equal(data.flags[MODULE_ID].art.img, BLADE);
  assert.equal(isArtUpgradeable(data), true);
});

test("the generic fallback still stamps default", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });

  // Keyword chain — no map entry for this name.
  const guessed = buildItemData({ name: "Vorpal Sword", type: "Weapon" });
  assert.notEqual(guessed.img, BLADE);
  assert.equal(guessed.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);

  // Type default — and a map entry must NOT reach a type that has its own.
  registerCuratedIconMap("collision", { "Urchin": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  const background = buildItemData({ name: "Urchin", type: "Background", description: "<p>x</p>" });
  assert.equal(background.img, "icons/environment/people/commoner.webp");
  assert.equal(background.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
});

test("a spell never takes an item map's icon", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  // The item maps are name-distinct only among THEMSELVES; spells have their
  // own curated channel and must not inherit gear art by name collision.
  registerCuratedIconMap("weapons", { "Web": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  const spell = buildItemData({ name: "Web", type: "Spell", tier: 1, description: "x" });
  assert.notEqual(spell.img, BLADE);
  assert.equal(spell.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
});

test("a draft's own art still reads as imported, not curated", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  // A draft that brought an image never consults the map — the image it
  // carried is what was imported, and that is what gets recorded.
  const carried = buildItemData({ name: "Bastard sword", type: "Weapon", img: "worlds/x/from-the-book.webp" });
  assert.equal(carried.img, "worlds/x/from-the-book.webp");
  assert.equal(carried.flags[MODULE_ID].art.state, ART_STATES.IMPORTED);
});

test("GM art still beats a curated map hit on reimport", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });

  const gmArt = "worlds/abletodestroy/art/my-sword.webp";
  const stored = {
    name: "Bastard sword", type: "Weapon", img: gmArt,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.CUSTOM, img: gmArt } } },
  };
  const payload = buildItemData({ name: "Bastard sword", type: "Weapon" });
  preserveCuratedFields(payload, stored, { generatedArtifact: false });
  assert.equal(payload.img, gmArt);
  assert.equal(payload.flags[MODULE_ID].art.state, ART_STATES.CUSTOM);
});

test("a map revision upgrades an untouched curated pick", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  const NEXT = "icons/weapons/swords/greatsword-crossguard-steel.webp";

  registerCuratedIconMap("v1", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });
  const first = buildItemData({ name: "Bastard sword", type: "Weapon" });
  const stored = { ...first, flags: { [MODULE_ID]: { art: first.flags[MODULE_ID].art } } };
  assert.equal(classifyArt(stored), ART_STATES.CURATED);

  _resetCuratedIconMaps();
  registerCuratedIconMap("v2", { "Bastard sword": NEXT }, { space: CURATED_KEY_SPACES.BARE });
  const payload = buildItemData({ name: "Bastard sword", type: "Weapon" });
  preserveCuratedFields(payload, stored, { generatedArtifact: false });
  assert.equal(payload.img, NEXT);
  assert.equal(payload.flags[MODULE_ID].art.state, ART_STATES.CURATED);
});

test("a registered map participates in legacy unmarked classification", (t) => {
  t.after(_resetCuratedIconMaps);
  _resetCuratedIconMaps();
  registerCuratedIconMap("weapons", { "Bastard sword": BLADE }, { space: CURATED_KEY_SPACES.BARE });

  // Accepted and documented: an unmarked document wearing the map's CURRENT
  // path reads as the module's pick and stays upgradeable, because
  // defaultItemImg is what art-provenance asks for as `moduleDefaultImg`.
  const legacy = { name: "Bastard sword", type: "Weapon", img: BLADE, flags: { [MODULE_ID]: { imported: true } } };
  assert.equal(classifyArt(legacy, { moduleDefaultImg: defaultItemImg(legacy) }), ART_STATES.DEFAULT);

  // Remove the row and the same document reclassifies as the GM's — the safe
  // direction for that reclassification to move.
  _resetCuratedIconMaps();
  assert.equal(classifyArt(legacy, { moduleDefaultImg: defaultItemImg(legacy) }), ART_STATES.CUSTOM);
});
