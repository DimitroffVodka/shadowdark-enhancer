/**
 * Review #12 regressions: corrected class re-imports must detect stale
 * content instead of blindly reusing same-named docs. Pure diff-helper
 * coverage; the Foundry-bound update path is live-probed via MCP.
 * All fixture data is invented — no book content.
 *
 * A3b extends this to the art half of the same re-import: a corrected paste
 * still wins on text and effects, but the GM's own icon is theirs to keep.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/importer/char-content/class-unit-importer.mjs";

const {
  _deepEq, _subsetEq, _staleFields, _effectShape,
  _classArtDecision, _talentData, _classAbilityData, CLASS_CONTENT_DEFAULT_IMG,
} = _internals;

const MOD = "shadowdark-enhancer";
const MANAGED_ITEMS_PACK = "world.shadowdark-enhancer--items";
const TALENT_DEFAULT = CLASS_CONTENT_DEFAULT_IMG.Talent;
const OVERLAY_ART = "icons/magic/unholy/silhouette-robe-evil-power.webp";
const NEW_OVERLAY_ART = "icons/magic/control/energy-stream-link-blue.webp";
const GM_ART = "worlds/abletodestroy/art/my-talent.webp";

const art = (state, img) => ({ state, img });

/** A corrected-import payload for one overlay-wired Talent. */
const payload = (img, state, description = "<p>Old.</p>") => ({
  name: "Deep Pockets", type: "Talent", img,
  system: { description, level: 1, talentClass: "class", source: { title: "wr" } },
  effects: [],
  flags: { [MOD]: { imported: true, art: art(state, img) } },
});

/** A stored document with the same content the payload describes. */
const stored = (img, flags, description = "<p>Old.</p>") => ({
  img,
  system: { description, level: 1, talentClass: "class", source: { title: "wr" }, lost: false },
  effects: [],
  flags: { [MOD]: { imported: true, ...flags }, core: {} },
  folder: "somewhere-else",
});

/** What `_ensureItem` hands to `_staleFields` once the art decision is applied. */
const applyArt = (data, decision) => ({
  ...data,
  img: decision.img,
  flags: { ...data.flags, [MOD]: { ...data.flags[MOD], art: decision.provenance } },
});

test("_deepEq: structural equality, order-insensitive keys, array order-sensitive", () => {
  assert.ok(_deepEq({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
  assert.ok(!_deepEq({ a: 1 }, { a: 2 }));
  assert.ok(!_deepEq([1, 2], [2, 1]));
  assert.ok(!_deepEq(null, {}));
  assert.ok(_deepEq(null, null));
});

test("_staleFields: identical import-owned fields → no stale fields", () => {
  const data = {
    name: "Sneak", type: "Talent", img: "icons/x.webp",
    system: { description: "<p>Old text.</p>", level: 1, talentClass: "class", source: { title: "wr" } },
    effects: [],
    flags: { "shadowdark-enhancer": { imported: true } },
  };
  const docObj = {
    img: "icons/x.webp",
    // stored doc carries EXTRA schema fields the import doesn't own — ignored
    system: { ...data.system, lost: false, magicItem: false },
    effects: [],
    flags: { "shadowdark-enhancer": { imported: true, source: "CS1" }, core: {} },
    folder: "somewhere-else",   // folder differences never count as stale
  };
  assert.deepEqual(_staleFields(docObj, data), []);
});

test("_staleFields: nested schema-filled keys never count as stale (live-caught)", () => {
  // Import defines a 3-key spellcasting object; the stored doc's schema adds
  // spellsknown etc. — an identical re-import must NOT report an update.
  const data = { system: { spellcasting: { ability: "", baseDifficulty: 10, class: "__not_spellcaster__" } } };
  const docObj = { system: { spellcasting: { ability: "", baseDifficulty: 10, class: "__not_spellcaster__", spellsknown: {} } } };
  assert.deepEqual(_staleFields(docObj, data), []);
  assert.ok(_subsetEq(data.system, docObj.system));
  // but a value the import DOES own still trips it
  const corrected = { system: { spellcasting: { ...data.system.spellcasting, ability: "int" } } };
  assert.deepEqual(_staleFields(docObj, corrected), ["system.spellcasting"]);
});

test("_staleFields: corrected description / titles / effects are detected", () => {
  const base = {
    img: "icons/x.webp",
    system: { description: "<p>Old.</p>", titles: [{ from: 1, to: 2, lawful: "Squire" }] },
    effects: [],
    flags: {},
  };
  const corrected = {
    img: "icons/x.webp",
    system: { description: "<p>New corrected.</p>", titles: [{ from: 1, to: 2, lawful: "Knave" }] },
    effects: [{ name: "Buff", system: { changes: [{ key: "system.bonuses.x", value: "1" }] } }],
    flags: {},
  };
  const fields = _staleFields(base, corrected);
  assert.ok(fields.includes("system.description"));
  assert.ok(fields.includes("system.titles"));
  assert.ok(fields.includes("effects"));
});

test("_effectShape: core changes and SD system.changes normalize identically", () => {
  const core = [{ name: "E", transfer: true, changes: [{ key: "k", mode: 2, value: 1 }] }];
  const sd = [{ name: "E", system: { changes: [{ key: "k", value: "1" }] } }];
  assert.ok(_deepEq(_effectShape(core), _effectShape(sd)), "mode default 2 + value stringified");
});

// ─── A3b: class-content art provenance ───────────────────────────────────────

test("A3b: the payload builders stamp the state their art came from", () => {
  const plain = _talentData("Deep Pockets", "<p>x</p>", "wr");
  assert.equal(plain.img, TALENT_DEFAULT, "no overlay art → the type default");
  assert.deepEqual(plain.flags[MOD].art, art("default", TALENT_DEFAULT));

  const wired = _talentData("Deep Pockets", "<p>x</p>", "wr", {
    effects: [{ name: "E", img: OVERLAY_ART, changes: [] }],
  });
  assert.equal(wired.img, OVERLAY_ART);
  assert.deepEqual(wired.flags[MOD].art, art("curated", OVERLAY_ART),
    "overlay-wired art is a deliberate module pick, not a default");

  const ability = _classAbilityData("Berserk", "<p>x</p>", "wr", {
    effects: [{ name: "E", img: OVERLAY_ART, changes: [] }],
  });
  assert.deepEqual(ability.flags[MOD].art, art("curated", OVERLAY_ART));
  assert.deepEqual(_classAbilityData("Berserk", "<p>x</p>", "wr").flags[MOD].art,
    art("default", TALENT_DEFAULT));
});

test("A3b: a GM-changed Talent icon survives a corrected re-import", () => {
  // The GM replaced the overlay's icon; the import carries a NEW overlay icon.
  const data = payload(NEW_OVERLAY_ART, "curated", "<p>Corrected.</p>");
  const doc = stored(GM_ART, { art: art("curated", OVERLAY_ART) });

  const decision = _classArtDecision(data, doc);
  assert.equal(decision.preserved, true);
  assert.equal(decision.reason, "gm-custom");
  assert.equal(decision.img, GM_ART, "the GM's picture wins");
  assert.deepEqual(decision.provenance, art("custom", GM_ART));

  // …and the corrected TEXT still wins: the art decision buys the image only.
  assert.deepEqual(_staleFields(doc, applyArt(data, decision)), ["system.description"]);
});

test("A3b: GM art on otherwise identical content is not stale solely because of img", () => {
  const data = payload(NEW_OVERLAY_ART, "curated");
  const doc = stored(GM_ART, { art: art("curated", OVERLAY_ART) });
  assert.deepEqual(_staleFields(doc, data), ["img"], "before the decision, img reads stale");
  assert.deepEqual(_staleFields(doc, applyArt(data, _classArtDecision(data, doc))), [],
    "after it, nothing is stale — the doc is reused untouched");
});

test("A3b: untouched module-curated overlay art still upgrades", () => {
  // The stored image is byte-identical to the witness we stamped beside it.
  const data = payload(NEW_OVERLAY_ART, "curated");
  const doc = stored(OVERLAY_ART, { art: art("curated", OVERLAY_ART) });

  const decision = _classArtDecision(data, doc);
  assert.equal(decision.preserved, false);
  assert.equal(decision.reason, "upgrade-curated");
  assert.equal(decision.img, NEW_OVERLAY_ART);
  assert.deepEqual(decision.provenance, art("curated", NEW_OVERLAY_ART));
  assert.deepEqual(_staleFields(doc, applyArt(data, decision)), ["img"], "the upgrade is written");
});

test("A3b: a stamped default upgrades to newly wired overlay art", () => {
  const data = payload(OVERLAY_ART, "curated");
  const doc = stored(TALENT_DEFAULT, { art: art("default", TALENT_DEFAULT) });
  const decision = _classArtDecision(data, doc);
  assert.equal(decision.reason, "upgrade-default");
  assert.equal(decision.img, OVERLAY_ART);
});

test("A3b: legacy unmarked class content classifies against what this module writes", () => {
  const data = payload(OVERLAY_ART, "curated");

  // Wearing the type default — the module's automatic pick — so it upgrades.
  const onDefault = _classArtDecision(data, stored(TALENT_DEFAULT, {}));
  assert.equal(onDefault.reason, "upgrade-default");
  assert.equal(onDefault.img, OVERLAY_ART);

  // Wearing exactly the image this import carries: ours either way, and
  // recording it as ours keeps it upgradeable next time.
  const onSame = _classArtDecision(data, stored(OVERLAY_ART, {}));
  assert.equal(onSame.preserved, false);
  assert.equal(onSame.img, OVERLAY_ART);
  assert.deepEqual(onSame.provenance, art("curated", OVERLAY_ART));

  // Anything else on an unmarked document is the GM's, and is preserved.
  const onGmArt = _classArtDecision(data, stored(GM_ART, {}));
  assert.equal(onGmArt.preserved, true);
  assert.equal(onGmArt.img, GM_ART);
});

test("A3b: a blank stored image is not art to protect", () => {
  const data = payload(OVERLAY_ART, "curated");
  const decision = _classArtDecision(data, stored("", {}));
  assert.equal(decision.preserved, false);
  assert.equal(decision.img, OVERLAY_ART);
});

test("A3b: the generated-artifact boundary stays structural", () => {
  const data = payload(OVERLAY_ART, "curated");
  const doc = stored(GM_ART, { generated: true });
  // Overlay gear lands in the managed Items pack, where an explicitly generated
  // artifact is replace-always (A7/D6) — art included.
  assert.equal(_classArtDecision(data, doc, MANAGED_ITEMS_PACK).reason, "generated-artifact");
  // The same marker outside that pack is not the boundary; the GM art survives.
  assert.equal(_classArtDecision(data, doc, "world.shadowdark-enhancer--talents").preserved, true);
  // A generated Monster Spell's own marker is a DIFFERENT contract and must not
  // open this door (A8).
  const spell = stored(GM_ART, { monsterSpell: { generated: true, libraryId: "x" } });
  assert.equal(_classArtDecision(data, spell, MANAGED_ITEMS_PACK).preserved, true);
});

test("A3b: the art stamp is bookkeeping, never a stale field", () => {
  // A pre-provenance document lacks the stamp entirely. Reporting that as a
  // stale `flags` would rewrite every class-content doc in the world on the
  // first re-import after the upgrade.
  const data = payload(TALENT_DEFAULT, "default");
  assert.deepEqual(_staleFields(stored(TALENT_DEFAULT, {}), data), []);
  // A stamp that disagrees is likewise not content — the image already decided.
  assert.deepEqual(_staleFields(stored(TALENT_DEFAULT, { art: art("curated", TALENT_DEFAULT) }), data), []);
  // …but a real flag difference still trips it.
  const renamed = { ...data, flags: { [MOD]: { imported: true, usesRule: { type: "base", base: 2 } } } };
  assert.deepEqual(_staleFields(stored(TALENT_DEFAULT, {}), renamed), ["flags"]);
});
