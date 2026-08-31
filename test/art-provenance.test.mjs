// A3 — explicit art provenance for imported Items.
//
// Covers the four image states (default / untouched imported / module-curated /
// GM-custom), every transition the replace path can take, the deterministic
// classification of legacy unmarked documents, and the structural
// generated-artifact exception that stays replace-always.
//
// The two regressions that motivated the ticket are pinned at the bottom: the
// old `payload.img.startsWith("icons/")` rule read the wrong document and got
// this module's OWN bundled Shikashi defaults wrong (erasing GM art), while
// treating every deliberate curated `icons/...` pick as un-upgradeable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  ART_STATES,
  UPGRADEABLE_ART_STATES,
  MANAGED_ITEMS_PACK,
  artProvenance,
  readArtProvenance,
  normalizeArtPath,
  classifyArt,
  isArtUpgradeable,
  decideImportArt,
  isGeneratedArtifact,
  isGeneratedManagedItem,
} from "../scripts/shared/art-provenance.mjs";
import { buildItemData, defaultItemImg, preserveCuratedFields } from "../scripts/importer/items/item-importer.mjs";

const GM_ART = "worlds/abletodestroy/art/silver-dagger.webp";
const SHIKASHI_DAGGER = "modules/shadowdark-enhancer/assets/icons/shikashi/dagger.webp";

/** A stored document with an explicit provenance stamp. */
const marked = (state, img, extra = {}) => ({
  name: "Silver Dagger", type: "Weapon", img,
  flags: { [MODULE_ID]: { imported: true, art: { state, img: extra.stampImg ?? img } } },
  ...extra.doc,
});

/** A stored document from before the stamp existed. */
const legacy = (img, overrides = {}) => ({
  name: "Silver Dagger", type: "Weapon", img,
  flags: { [MODULE_ID]: { imported: true } },
  ...overrides,
});

// ── classification ──────────────────────────────────────────────────────────

test("a marked image still wearing the path we recorded keeps its state", () => {
  for (const state of UPGRADEABLE_ART_STATES) {
    assert.equal(classifyArt(marked(state, "icons/weapons/daggers/dagger-blue.webp")), state);
  }
  assert.equal(classifyArt(marked(ART_STATES.CUSTOM, GM_ART)), ART_STATES.CUSTOM);
});

test("an image that no longer matches its witness is GM-custom, whatever the path looks like", () => {
  // The GM swapped the art after we wrote it. The stamp still says "default".
  const doc = marked(ART_STATES.DEFAULT, GM_ART, { stampImg: SHIKASHI_DAGGER });
  assert.equal(classifyArt(doc), ART_STATES.CUSTOM);

  // Even when the GM's replacement is itself a core `icons/...` path — the
  // shape of the path is never the question.
  const coreLook = marked(ART_STATES.DEFAULT, "icons/weapons/daggers/dagger-jeweled-blue.webp", { stampImg: SHIKASHI_DAGGER });
  assert.equal(classifyArt(coreLook), ART_STATES.CUSTOM);
});

test("a stamp this version does not understand is treated as custom, not overwritten", () => {
  assert.equal(classifyArt(marked("some-future-state", GM_ART)), ART_STATES.CUSTOM);
  assert.equal(classifyArt({ img: GM_ART, flags: { [MODULE_ID]: { art: { state: 42, img: GM_ART } } } }), ART_STATES.CUSTOM);
});

test("a document with no image at all is default — there is nothing to protect", () => {
  assert.equal(classifyArt({ name: "Rope", type: "Basic", img: "" }), ART_STATES.DEFAULT);
  assert.equal(classifyArt({ name: "Rope", type: "Basic" }), ART_STATES.DEFAULT);
  assert.equal(classifyArt(marked(ART_STATES.CUSTOM, "")), ART_STATES.DEFAULT);
});

test("legacy unmarked content is classified deterministically and totally", () => {
  const moduleDefaultImg = defaultItemImg({ name: "Silver Dagger", type: "Weapon" });
  // Wearing exactly what this module would pick today → ours, upgradeable.
  assert.equal(classifyArt(legacy(moduleDefaultImg), { moduleDefaultImg }), ART_STATES.DEFAULT);
  // Anything else → the GM's, preserved. No third answer exists.
  assert.equal(classifyArt(legacy(GM_ART), { moduleDefaultImg }), ART_STATES.CUSTOM);
  assert.equal(classifyArt(legacy("icons/weapons/daggers/dagger-blue.webp"), { moduleDefaultImg }), ART_STATES.CUSTOM);
  assert.equal(classifyArt(legacy(""), { moduleDefaultImg }), ART_STATES.DEFAULT);
});

test("legacy classification tolerates the path spellings Foundry round-trips", () => {
  const moduleDefaultImg = defaultItemImg({ name: "Silver Dagger", type: "Weapon" });
  assert.equal(classifyArt(legacy(`  ${moduleDefaultImg}  `), { moduleDefaultImg }), ART_STATES.DEFAULT);
  assert.equal(classifyArt(legacy(`./${moduleDefaultImg}`), { moduleDefaultImg }), ART_STATES.DEFAULT);
  assert.equal(normalizeArtPath(undefined), "");
});

test("only the three module-written states are upgradeable", () => {
  assert.deepEqual([...UPGRADEABLE_ART_STATES].sort(), ["curated", "default", "imported"]);
  assert.equal(isArtUpgradeable(marked(ART_STATES.DEFAULT, SHIKASHI_DAGGER)), true);
  assert.equal(isArtUpgradeable(marked(ART_STATES.CUSTOM, GM_ART)), false);
});

test("artProvenance refuses to mint a state it does not know", () => {
  assert.deepEqual(artProvenance("curated", "a.webp"), { state: "curated", img: "a.webp" });
  assert.deepEqual(artProvenance("nonsense", "a.webp"), { state: "default", img: "a.webp" });
  assert.equal(readArtProvenance({ flags: { [MODULE_ID]: {} } }), null);
  assert.equal(readArtProvenance({}), null);
});

// ── the transition table ────────────────────────────────────────────────────

test("every state transition the replace path can take", () => {
  const incoming = { incomingImg: "icons/weapons/daggers/curated.webp", incomingState: ART_STATES.CURATED };
  const moduleDefaultImg = defaultItemImg({ name: "Silver Dagger", type: "Weapon" });

  const cases = [
    ["default → upgraded",  marked(ART_STATES.DEFAULT, SHIKASHI_DAGGER),                 false, "upgrade-default"],
    ["imported → upgraded", marked(ART_STATES.IMPORTED, "worlds/x/from-the-book.webp"),  false, "upgrade-imported"],
    ["curated → upgraded",  marked(ART_STATES.CURATED, "icons/weapons/daggers/old.webp"), false, "upgrade-curated"],
    ["custom → preserved",  marked(ART_STATES.CUSTOM, GM_ART),                            true,  "gm-custom"],
    ["legacy default → upgraded", legacy(moduleDefaultImg),                               false, "upgrade-default"],
    ["legacy custom → preserved", legacy(GM_ART),                                         true,  "gm-custom"],
    ["no art → takes incoming",   legacy(""),                                             false, "no-existing-art"],
  ];

  for (const [label, existing, preserved, reason] of cases) {
    const got = decideImportArt({ ...incoming, existing, moduleDefaultImg });
    assert.equal(got.preserved, preserved, label);
    assert.equal(got.reason, reason, label);
    assert.equal(got.img, preserved ? existing.img : incoming.incomingImg, label);
    // Whatever wins is stamped, so the next import never has to guess again.
    assert.equal(got.provenance.img, got.img, label);
    assert.equal(got.provenance.state, preserved ? ART_STATES.CUSTOM : ART_STATES.CURATED, label);
  }
});

test("preserving GM art settles the verdict — the next import needs no legacy rule", () => {
  const first = decideImportArt({
    incomingImg: SHIKASHI_DAGGER,
    existing: legacy(GM_ART),
    moduleDefaultImg: defaultItemImg({ name: "Silver Dagger", type: "Weapon" }),
  });
  assert.equal(first.preserved, true);

  // The document now carries the custom stamp. Classify it with NO legacy hint
  // at all: the answer must not move.
  const settled = { name: "Silver Dagger", type: "Weapon", img: first.img, flags: { [MODULE_ID]: { art: first.provenance } } };
  assert.equal(classifyArt(settled), ART_STATES.CUSTOM);
  assert.equal(decideImportArt({ incomingImg: SHIKASHI_DAGGER, existing: settled }).preserved, true);
});

// ── the generated-artifact boundary ─────────────────────────────────────────

test("the generated boundary is structural: managed pack AND an explicit flag", () => {
  const generated = { img: GM_ART, flags: { [MODULE_ID]: { generated: true } } };
  const plain = { img: GM_ART, flags: { [MODULE_ID]: { imported: true } } };

  assert.equal(isGeneratedArtifact(generated), true);
  assert.equal(isGeneratedArtifact(plain), false);
  assert.equal(isGeneratedArtifact({}), false);

  assert.equal(isGeneratedManagedItem(generated, MANAGED_ITEMS_PACK), true);
  // Same flag, wrong pack — a generated Item copied into world.talents is not
  // on the authoritative side of the line.
  assert.equal(isGeneratedManagedItem(generated, "world.talents"), false);
  assert.equal(isGeneratedManagedItem(plain, MANAGED_ITEMS_PACK), false);
  assert.equal(isGeneratedManagedItem(generated, undefined), false);
});

test("REGRESSION: a Monster Spell's generated marker is NOT generic replace-always", () => {
  // "Generated" is not one policy. The Monster Spell library stamps
  // flags[MODULE_ID].monsterSpell.generated, and its contract is the OPPOSITE
  // of A7/D6's: a hand-edited generated spell is a curated CONFLICT and is
  // preserved (planMonsterSpellRefresh; docs/wiki/Monster-Spell-Library.md).
  // Since A1 those spells live in world.shadowdark-enhancer--items, so reading
  // that marker as replace-always would let an ordinary item-importer name
  // collision silently overwrite a spell the GM had curated.
  const curatedSpell = {
    name: "Blast - Mage", type: "Spell", img: GM_ART,
    flags: { [MODULE_ID]: { monsterSpell: { generated: true, libraryId: "lib-1" } } },
  };
  assert.equal(isGeneratedArtifact(curatedSpell), false);
  assert.equal(isGeneratedManagedItem(curatedSpell, MANAGED_ITEMS_PACK), false);

  // ...so it is governed by ordinary provenance, and its art survives.
  const decided = decideImportArt({
    incomingImg: SHIKASHI_DAGGER,
    existing: curatedSpell,
    moduleDefaultImg: defaultItemImg(curatedSpell),
    generatedArtifact: isGeneratedManagedItem(curatedSpell, MANAGED_ITEMS_PACK),
  });
  assert.equal(decided.preserved, true);
  assert.equal(decided.img, GM_ART);
});

test("REGRESSION: a curated Monster Spell runs the full preservation path, not the bypass", () => {
  // The full replace path, exactly as createItem drives it: the boundary is
  // computed from the stored document, so nothing here may skip preservation.
  const stored = {
    name: "Blast - Mage", type: "Spell", img: GM_ART,
    flags: { [MODULE_ID]: { monsterSpell: { generated: true, libraryId: "lib-1" } } },
    system: { description: "<p>My curated 3d6 version.</p>", properties: ["Compendium.x.Item.KEPT"] },
  };
  const payload = buildItemData({ name: "Blast - Mage", type: "Spell", tier: 3 });
  payload.system.properties = [];
  preserveCuratedFields(payload, stored, {
    generatedArtifact: isGeneratedManagedItem(stored, MANAGED_ITEMS_PACK),
  });

  assert.equal(payload.img, GM_ART, "curated art survives");
  assert.equal(payload.flags[MODULE_ID].art.state, ART_STATES.CUSTOM);
  assert.deepEqual(payload.system.properties, ["Compendium.x.Item.KEPT"], "curated properties survive");

  // The description is decided by preservedDescription, a contract A3 does not
  // touch — and it does NOT survive here. buildItemData's Spell path falls back
  // to `description = name`, so the incoming `<p>Blast - Mage</p>` reads as real
  // prose rather than an importer placeholder and wins. Pinned deliberately:
  // this is a pre-existing item-importer hazard on the Spell path, unchanged by
  // A3 and unrelated to the generated boundary, and it should be fixed where it
  // lives rather than papered over here.
  assert.equal(payload.system.description, "<p>Blast - Mage</p>");
});

test("the explicit A7/D6 marker in the protected Items pack IS still replace-always", () => {
  // The other half of the contract: opting in explicitly still works, and only
  // inside the protected pack.
  const stored = {
    name: "Murgazi Wine", type: "Basic", img: GM_ART,
    flags: { [MODULE_ID]: { generated: true } },
    system: { description: "<p>A hand-written tasting note.</p>" },
  };
  assert.equal(isGeneratedManagedItem(stored, MANAGED_ITEMS_PACK), true);

  const payload = buildItemData({ name: "Murgazi Wine", type: "Basic" });
  preserveCuratedFields(payload, stored, {
    generatedArtifact: isGeneratedManagedItem(stored, MANAGED_ITEMS_PACK),
  });
  assert.equal(payload.img, defaultItemImg({ name: "Murgazi Wine", type: "Basic" }));
  assert.equal(payload.system.description, "<p></p>");

  // The same document outside the protected pack falls back to preservation.
  const outside = buildItemData({ name: "Murgazi Wine", type: "Basic" });
  preserveCuratedFields(outside, stored, {
    generatedArtifact: isGeneratedManagedItem(stored, "world.talents"),
  });
  assert.equal(outside.img, GM_ART);
  assert.equal(outside.system.description, "<p>A hand-written tasting note.</p>");
});

test("a generated artifact is replace-always — even hand-edited art loses", () => {
  const got = decideImportArt({
    incomingImg: SHIKASHI_DAGGER,
    existing: marked(ART_STATES.CUSTOM, GM_ART),
    generatedArtifact: true,
  });
  assert.equal(got.preserved, false);
  assert.equal(got.reason, "generated-artifact");
  assert.equal(got.img, SHIKASHI_DAGGER);
});

// ── stamping at build time ──────────────────────────────────────────────────

test("buildItemData stamps the state the image actually came from", () => {
  const picked = buildItemData({ name: "Silver Dagger", type: "Weapon" });
  assert.equal(picked.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
  assert.equal(picked.flags[MODULE_ID].art.img, picked.img);

  const carried = buildItemData({ name: "Silver Dagger", type: "Weapon", img: "worlds/x/from-the-book.webp" });
  assert.equal(carried.flags[MODULE_ID].art.state, ART_STATES.IMPORTED);
  assert.equal(carried.img, "worlds/x/from-the-book.webp");

  const curated = buildItemData({ name: "Silver Dagger", type: "Weapon", img: "icons/weapons/daggers/dagger-blue.webp", artState: ART_STATES.CURATED });
  assert.equal(curated.flags[MODULE_ID].art.state, ART_STATES.CURATED);
});

test("a draft can never declare itself GM-custom", () => {
  // Only a human's edit produces `custom`, and only the replace path can see it.
  const d = buildItemData({ name: "Silver Dagger", type: "Weapon", img: "worlds/x/a.webp", artState: ART_STATES.CUSTOM });
  assert.equal(d.flags[MODULE_ID].art.state, ART_STATES.IMPORTED);
  const p = buildItemData({ name: "Rope", type: "Basic", artState: "custom" });
  assert.equal(p.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
});

test("every build path is stamped, and the stamp always names the stored image", () => {
  const drafts = [
    { name: "Magic Missile", type: "Spell", tier: 1 },
    { name: "Urchin", type: "Background" },
    { name: "Grit", type: "Talent" },
    { name: "Half-Elf", type: "Ancestry" },
    { name: "Witch", type: "Class" },
    { name: "Chain Shirt", type: "Armor", ac: { base: 13 } },
    { name: "Bastard Sword", type: "Weapon", damage: { oneHanded: "d8" } },
    { name: "Rope, 60'", type: "Basic" },
    { name: "Potion of Healing", type: "Potion" },
  ];
  for (const draft of drafts) {
    const data = buildItemData(draft);
    const art = data.flags?.[MODULE_ID]?.art;
    assert.ok(art, `${draft.name} carries an art stamp`);
    assert.equal(art.img, data.img, `${draft.name} stamp names the stored image`);
    assert.equal(art.state, ART_STATES.DEFAULT, `${draft.name} picked its own default`);
    // The default table and the builder must never disagree.
    assert.equal(data.img, defaultItemImg(draft), `${draft.name} default is reproducible`);
  }
});

test("defaultItemImg is reproducible from a stored document, not just a draft", () => {
  // The replace path only has the stored name and type to work from.
  const built = buildItemData({ name: "Emerald", type: "Gem" });
  assert.equal(defaultItemImg({ name: "Emerald", type: "Gem" }), built.img);
  assert.equal(defaultItemImg({ name: "Magic Missile", type: "Spell" }), buildItemData({ name: "Magic Missile", type: "Spell" }).img);
  assert.equal(defaultItemImg({ name: "Grit", type: "Talent" }), "icons/sundries/documents/document-torn-diagram-tan.webp");
  assert.ok(defaultItemImg({}).length > 0, "an unnamed, untyped document still gets a deterministic default");
});

// ── end to end through the replace path ─────────────────────────────────────

/** A replace as createItem performs it: build, then preserve against the stored doc. */
function reimport(draft, existing, opts) {
  const payload = buildItemData(draft);
  payload.flags[MODULE_ID].imported = true;
  preserveCuratedFields(payload, existing, opts);
  return payload;
}

test("REGRESSION: a bundled Shikashi default no longer erases the GM's art", () => {
  // The old rule asked whether the INCOMING path started with "icons/". This
  // module's own defaults live under modules/shadowdark-enhancer/assets/, so
  // they failed that test and were written straight over hand-picked art.
  const auto = buildItemData({ name: "Silver Dagger", type: "Weapon" });
  assert.ok(auto.img.startsWith("modules/shadowdark-enhancer/"), "precondition: the default is a module asset");
  assert.equal(auto.img.startsWith("icons/"), false);
  assert.equal(auto.img.includes("default"), false);

  const stored = { ...legacy(GM_ART), system: { description: "<p>The GM's own note.</p>" } };
  const out = reimport({ name: "Silver Dagger", type: "Weapon", damage: { oneHanded: "d4" } }, stored);
  assert.equal(out.img, GM_ART);
  assert.equal(out.flags[MODULE_ID].art.state, ART_STATES.CUSTOM);
});

test("REGRESSION: a deliberate curated pick can now replace an earlier curated pick", () => {
  // The old rule refused every incoming `icons/...` path, so a curated map
  // could never upgrade art it had itself written.
  const stored = { ...marked(ART_STATES.CURATED, "icons/weapons/daggers/dagger-blue.webp"), system: {} };
  const out = reimport(
    { name: "Silver Dagger", type: "Weapon", img: "icons/weapons/daggers/dagger-jeweled-blue.webp", artState: ART_STATES.CURATED },
    stored,
  );
  assert.equal(out.img, "icons/weapons/daggers/dagger-jeweled-blue.webp");
  assert.equal(out.flags[MODULE_ID].art.state, ART_STATES.CURATED);
});

test("an untouched imported image upgrades, and the GM's edit of it does not", () => {
  const first = buildItemData({ name: "Silver Dagger", type: "Weapon", img: "worlds/x/book-art.webp" });
  const stored = { name: "Silver Dagger", type: "Weapon", img: first.img, flags: first.flags, system: {} };
  const upgraded = reimport({ name: "Silver Dagger", type: "Weapon", img: "icons/weapons/daggers/curated.webp", artState: ART_STATES.CURATED }, stored);
  assert.equal(upgraded.img, "icons/weapons/daggers/curated.webp");

  // Same document, except the GM repainted it since the import.
  const edited = { ...stored, img: GM_ART };
  const kept = reimport({ name: "Silver Dagger", type: "Weapon", img: "icons/weapons/daggers/curated.webp", artState: ART_STATES.CURATED }, edited);
  assert.equal(kept.img, GM_ART);
});

test("a plain re-import of untouched content is byte-stable", () => {
  const draft = { name: "Rope, 60'", type: "Basic" };
  const first = buildItemData(draft);
  const stored = { name: draft.name, type: "Basic", img: first.img, flags: first.flags, system: { description: "<p>Sixty feet.</p>" } };
  const second = reimport(draft, stored);
  assert.equal(second.img, first.img);
  assert.deepEqual(second.flags[MODULE_ID].art, first.flags[MODULE_ID].art);
  // And again — no drift on the third pass.
  const third = reimport(draft, { ...stored, img: second.img, flags: second.flags });
  assert.deepEqual(third.flags[MODULE_ID].art, first.flags[MODULE_ID].art);
});

test("inside the generated boundary the whole document is authoritative, art included", () => {
  const stored = {
    name: "Murgazi Wine", type: "Basic", img: GM_ART,
    flags: { [MODULE_ID]: { generated: true, art: { state: ART_STATES.CUSTOM, img: GM_ART } } },
    system: { description: "<p>A hand-written tasting note.</p>", properties: ["Compendium.x.Item.KEPT"] },
  };
  const out = reimport({ name: "Murgazi Wine", type: "Basic" }, stored, { generatedArtifact: true });
  assert.notEqual(out.img, GM_ART);
  assert.equal(out.img, defaultItemImg({ name: "Murgazi Wine", type: "Basic" }));
  assert.equal(out.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
  // Replace-always means the GM's description and properties go too — this is
  // the A7/D6 boundary, not A3's preservation policy.
  assert.equal(out.system.description, "<p></p>");
  assert.deepEqual(out.system.properties ?? [], []);
});

test("the same document OUTSIDE the generated boundary keeps everything", () => {
  const stored = {
    name: "Murgazi Wine", type: "Basic", img: GM_ART,
    flags: { [MODULE_ID]: { imported: true } },
    system: { description: "<p>A hand-written tasting note.</p>" },
  };
  const out = reimport({ name: "Murgazi Wine", type: "Basic" }, stored);
  assert.equal(out.img, GM_ART);
  assert.equal(out.system.description, "<p>A hand-written tasting note.</p>");
});

test("art preservation does not disturb the description and property contracts", () => {
  const stored = {
    name: "Lance", type: "Weapon", img: GM_ART,
    flags: { [MODULE_ID]: { imported: true } },
    system: { description: "<p>The GM's Lance write-up.</p>", properties: ["Compendium.x.Item.CHARGE"] },
  };
  const out = reimport({ name: "Lance", type: "Weapon", damage: { oneHanded: "d8" } }, stored);
  assert.equal(out.system.description, "<p>The GM's Lance write-up.</p>");
  assert.deepEqual(out.system.properties, ["Compendium.x.Item.CHARGE"]);
  assert.equal(out.img, GM_ART);
});
