// D2 — the reviewed armor map and its A3/A4 integration.
//
// The expected rows below are intentionally independent of the production map:
// this test is the category census, not a Set made from the map that it is
// supposed to audit.  The path predicate reads the real Foundry public icon
// tree that N3 used, so a valid-looking but absent path fails as missing-path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { ART_STATES, classifyArt, isArtUpgradeable } from "../scripts/shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  auditCuratedIconRegistry,
  buildCuratedIconRegistry,
  curatedIconRegistry,
  curatedNameKey,
  defineCuratedIconMap,
  resolveCuratedIcon,
} from "../scripts/shared/curated-icons.mjs";
import { buildItemData, defaultItemImg, preserveCuratedFields } from "../scripts/importer/items/item-importer.mjs";
import { ARMOR_ICONS } from "../scripts/shared/curated-icon-maps/armor-icons.mjs";
// The production entry-point uses this same side-effect index. Importing it in
// the category test proves the map is discoverable without a shared registry
// array; the named import above gives the test its owned map for isolation.
import "../scripts/shared/curated-icon-maps/index.mjs";

const EXPECTED_ROWS = Object.freeze({
  "Leather armor": "icons/equipment/chest/breastplate-layered-leather-brown.webp",
  "Chainmail": "icons/commodities/metal/mail-chain-steel.webp",
  "Chainmail, mithral": "icons/equipment/chest/breastplate-banded-steel-grey.webp",
  "Mithral Chainmail": "icons/equipment/chest/breastplate-banded-steel-grey.webp",
  "Plate mail": "icons/equipment/chest/breastplate-layered-steel.webp",
  "Plate mail, mithral": "icons/equipment/chest/breastplate-cuirass-steel-blue.webp",
  "Mithral Plate Mail": "icons/equipment/chest/breastplate-cuirass-steel-blue.webp",
  "Shield": "icons/equipment/shield/heater-steel-gray.webp",
  "Shield, mithral": "icons/equipment/shield/heater-crystal-blue.webp",
  "Mithral Shield": "icons/equipment/shield/heater-crystal-blue.webp",
  "Round shield": "icons/equipment/shield/shield-round-boss-wood-brown.webp",
  "Round shield, mithral": "icons/equipment/shield/round-wooden-boss-steel-yellow-blue.webp",
  "Mithral Round Shield": "icons/equipment/shield/round-wooden-boss-steel-yellow-blue.webp",
});

const CANONICAL_NAMES = Object.freeze([
  "Leather armor",
  "Chainmail",
  "Mithral Chainmail",
  "Plate mail",
  "Mithral Plate Mail",
  "Shield",
  "Mithral Shield",
  "Round shield",
  "Mithral Round Shield",
]);

const ALIAS_PAIRS = Object.freeze([
  ["Chainmail, mithral", "Mithral Chainmail"],
  ["Plate mail, mithral", "Mithral Plate Mail"],
  ["Shield, mithral", "Mithral Shield"],
  ["Round shield, mithral", "Mithral Round Shield"],
]);

// N3's authoritative inventory is the Foundry installation, not the map. This
// deliberately performs a filesystem check per accepted path rather than
// constructing a Set from EXPECTED_ROWS or ARMOR_ICONS.
const FOUNDRY_PUBLIC = "/home/patricks/FoundryV14/public";
const FOUNDRY_ICONS = path.join(FOUNDRY_PUBLIC, "icons");

function realFoundryIconExists(assetPath) {
  const relative = String(assetPath ?? "");
  if (!relative.startsWith("icons/") || relative.includes("..")) return false;
  return existsSync(path.join(FOUNDRY_PUBLIC, relative));
}

function auditedAgainstFoundry(registry) {
  let calls = 0;
  const report = auditCuratedIconRegistry(registry, {
    pathExists: (assetPath) => {
      calls++;
      return realFoundryIconExists(assetPath);
    },
  });
  return { report, calls };
}

function armorDraft(name, extra = {}) {
  return { name, type: "Armor", ac: { base: 13 }, ...extra };
}

function reimportArmor(draft, existing) {
  const payload = buildItemData(draft);
  preserveCuratedFields(payload, existing);
  return payload;
}

test("the armor map is discovered and owns exactly the N3 13-row census", () => {
  assert.equal(existsSync(FOUNDRY_ICONS), true, "N3's authoritative Foundry icon inventory is required");
  assert.equal(ARMOR_ICONS.label, "armor");
  assert.equal(ARMOR_ICONS.space, CURATED_KEY_SPACES.BARE);
  assert.equal(ARMOR_ICONS.problems.length, 0);

  const expectedKeys = Object.keys(EXPECTED_ROWS).map(curatedNameKey).sort();
  const actualKeys = [...ARMOR_ICONS.entries.keys()].sort();
  assert.equal(actualKeys.length, 13);
  assert.deepEqual(actualKeys, expectedKeys);
  for (const [name, expectedPath] of Object.entries(EXPECTED_ROWS)) {
    assert.equal(ARMOR_ICONS.entries.get(curatedNameKey(name)), expectedPath, name);
  }

  const discovered = curatedIconRegistry();
  assert.ok(discovered.maps.includes(ARMOR_ICONS), "the A4 discovery index registers the armor module");
});

test("the nine canonical armors stay distinct while four mithral aliases share their reviewed paths", () => {
  assert.equal(new Set(CANONICAL_NAMES.map(curatedNameKey)).size, 9);
  assert.equal(CANONICAL_NAMES.length, 9);
  assert.equal(ARMOR_ICONS.entries.size, 13, "aliases are rows for spelling coverage, not new canonical armors");

  for (const [alias, canonical] of ALIAS_PAIRS) {
    assert.notEqual(curatedNameKey(alias), curatedNameKey(canonical), `${alias} remains a deliberate source spelling`);
    assert.equal(
      ARMOR_ICONS.entries.get(curatedNameKey(alias)),
      ARMOR_ICONS.entries.get(curatedNameKey(canonical)),
      `${alias} → ${canonical}`,
    );
  }
});

test("the A4 audit covers every armor row against the real Foundry icon inventory", () => {
  const registry = buildCuratedIconRegistry([ARMOR_ICONS]);
  const { report, calls } = auditedAgainstFoundry(registry);

  assert.equal(report.total, 13);
  assert.equal(report.bare, 13);
  assert.equal(report.sourced, 0, "armor keys are source-agnostic");
  assert.deepEqual(report.perMap, [{ label: "armor", space: CURATED_KEY_SPACES.BARE, entries: 13 }]);
  assert.deepEqual(report.problems, []);
  assert.equal(calls, 13, "the existence predicate was applied to every accepted armor row");
});

test("a valid-looking absent armor path is reported as missing-path by the real inventory gate", () => {
  const missing = "icons/equipment/chest/d2-armor-icons-definitely-absent.webp";
  assert.equal(realFoundryIconExists(missing), false, "the missing-path fixture must stay absent from Foundry");
  const broken = defineCuratedIconMap("armor-missing-path", {
    ...EXPECTED_ROWS,
    "D2 missing-path fixture": missing,
  }, { space: CURATED_KEY_SPACES.BARE });
  const { report } = auditedAgainstFoundry(buildCuratedIconRegistry([broken]));

  assert.equal(report.total, 14);
  assert.deepEqual(report.problems, [{
    map: "armor-missing-path",
    kind: "missing-path",
    detail: `d2 missing-path fixture → ${JSON.stringify(missing)}`,
  }]);
});

test("every armor lookup stays source-agnostic and carries the reviewed path", () => {
  for (const [name, expectedPath] of Object.entries(EXPECTED_ROWS)) {
    for (const source of [undefined, "", "Core", "Western Reaches", "Cursed Scroll #3", "homebrew"]) {
      assert.equal(resolveCuratedIcon({ name, source }), expectedPath, `${name} / ${source ?? "no source"}`);
    }
  }
});

test("a fresh/default armor import takes the curated map and stamps curated provenance", () => {
  const data = buildItemData(armorDraft("Leather armor"));
  const expectedPath = EXPECTED_ROWS["Leather armor"];

  assert.equal(data.img, expectedPath);
  assert.deepEqual(data.flags[MODULE_ID].art, { state: ART_STATES.CURATED, img: expectedPath });
  assert.equal(classifyArt(data), ART_STATES.CURATED);
  assert.equal(isArtUpgradeable(data), true);
});

test("an untouched imported armor image upgrades to the curated map on reimport", () => {
  const first = buildItemData(armorDraft("Chainmail", {
    img: "worlds/abletodestroy/imports/chainmail-from-book.webp",
  }));
  assert.equal(first.flags[MODULE_ID].art.state, ART_STATES.IMPORTED);

  const upgraded = reimportArmor(armorDraft("Chainmail"), {
    ...first,
    system: { ...first.system },
  });
  assert.equal(upgraded.img, EXPECTED_ROWS.Chainmail);
  assert.deepEqual(upgraded.flags[MODULE_ID].art, {
    state: ART_STATES.CURATED,
    img: EXPECTED_ROWS.Chainmail,
  });
});

test("a map revision upgrades an untouched curated armor image", () => {
  const previousMapPath = "icons/equipment/chest/breastplate-layered-steel.webp";
  const currentMapPath = EXPECTED_ROWS["Leather armor"];
  const stored = {
    name: "Leather armor",
    type: "Armor",
    img: previousMapPath,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.CURATED, img: previousMapPath } } },
    system: {},
  };

  assert.equal(classifyArt(stored), ART_STATES.CURATED);
  const upgraded = reimportArmor(armorDraft("Leather armor"), stored);
  assert.equal(upgraded.img, currentMapPath);
  assert.equal(upgraded.flags[MODULE_ID].art.state, ART_STATES.CURATED);
});

test("GM-custom armor art survives a curated-map reimport", () => {
  const curated = buildItemData(armorDraft("Shield"));
  const gmArt = "worlds/abletodestroy/art/gm-shield.webp";
  const stored = {
    ...curated,
    img: gmArt,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.CURATED, img: curated.img } } },
    system: { ...curated.system },
  };

  const preserved = reimportArmor(armorDraft("Shield"), stored);
  assert.equal(preserved.img, gmArt);
  assert.deepEqual(preserved.flags[MODULE_ID].art, { state: ART_STATES.CUSTOM, img: gmArt });
});

test("an unmapped armor keeps the broad fallback and default provenance", () => {
  const data = buildItemData(armorDraft("Scale mail"));
  assert.equal(resolveCuratedIcon({ name: "Scale mail" }), null);
  assert.equal(data.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
  assert.equal(data.img, defaultItemImg({ name: "Scale mail", type: "Armor" }));
  assert.ok(data.img, "the fallback remains a usable image");
});

test("an already-stamped armor is not reclassified merely because the map is enabled", () => {
  const priorDefaultPath = "icons/equipment/chest/breastplate-layered-steel.webp";
  const stored = {
    name: "Leather armor",
    type: "Armor",
    img: priorDefaultPath,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.DEFAULT, img: priorDefaultPath } } },
    system: {},
  };

  // The enabled map now answers with the leather-specific path, but A3 trusts
  // the existing witness before considering that new automatic answer.
  assert.equal(defaultItemImg(stored), EXPECTED_ROWS["Leather armor"]);
  assert.equal(classifyArt(stored), ART_STATES.DEFAULT);
  const upgraded = reimportArmor(armorDraft("Leather armor"), stored);
  assert.equal(upgraded.img, EXPECTED_ROWS["Leather armor"]);
  assert.equal(upgraded.flags[MODULE_ID].art.state, ART_STATES.CURATED);
});
