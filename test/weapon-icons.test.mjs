// D1 — N3's complete weapon map and its A3/A4 application contract.
//
// The path gate deliberately reads the installed Foundry public icon tree. A
// Set assembled from the map would only prove that the map repeats itself, not
// that the reviewed assets exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { ART_STATES, classifyArt } from "../scripts/shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  auditCuratedIconRegistry,
  buildCuratedIconRegistry,
  curatedIconRegistry,
  curatedNameKey,
  defineCuratedIconMap,
  registerCuratedIconMap,
  resolveCuratedIcon,
  _resetCuratedIconMaps,
} from "../scripts/shared/curated-icons.mjs";
import { buildItemData, defaultItemImg, preserveCuratedFields } from "../scripts/importer/items/item-importer.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";
import { WEAPON_ICONS } from "../scripts/shared/curated-icon-maps/weapon-icons.mjs";

const FOUNDRY_ICON_ROOT = path.resolve("/home/patricks/FoundryV14/public/icons");

/** Build an inventory in the same `icons/...` namespace used by the map. */
function foundryIconInventory(dir, prefix = "icons", out = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) foundryIconInventory(full, relative, out);
    else if (entry.isFile() && entry.name.endsWith(".webp")) out.add(relative);
  }
  return out;
}

const FOUNDRY_ICONS = foundryIconInventory(FOUNDRY_ICON_ROOT);
const pathExists = (iconPath) => FOUNDRY_ICONS.has(iconPath);

const EXPECTED_WEAPON_KEYS = [
  "bastard sword",
  "blowgun",
  "bolas",
  "boomerang",
  "chakram",
  "club",
  "club (obsidian)",
  "crossbow",
  "dagger",
  "dagger (obsidian)",
  "falchion",
  "greataxe",
  "greatsword",
  "handaxe",
  "javelin",
  "lance",
  "longbow",
  "longsword",
  "mace",
  "morningstar",
  "pike",
  "rapier",
  "razor chain",
  "sai",
  "scimitar",
  "shortbow",
  "shortsword",
  "shuriken",
  "sling",
  "spear",
  "spear (obsidian)",
  "spear-thrower",
  "staff",
  "stave",
  "strikes",
  "warhammer",
  "whip",
];

function sorted(values) {
  return [...values].sort();
}

function snapshotLiveMaps() {
  return [...curatedIconRegistry().maps];
}

function restoreLiveMaps(maps) {
  _resetCuratedIconMaps();
  for (const map of maps) {
    registerCuratedIconMap(map.label, Object.fromEntries(map.entries), { space: map.space });
  }
}

test("N3 weapon map is discovered with the exact 37-row census and real paths", () => {
  const registry = buildCuratedIconRegistry([WEAPON_ICONS]);
  const report = auditCuratedIconRegistry(registry, { pathExists });

  assert.ok(FOUNDRY_ICONS.size > 1_000, "the path predicate must use the real Foundry icon inventory");
  assert.equal(WEAPON_ICONS.space, CURATED_KEY_SPACES.BARE);
  assert.equal(WEAPON_ICONS.entries.size, 37);
  assert.deepEqual(sorted(WEAPON_ICONS.entries.keys()), sorted(EXPECTED_WEAPON_KEYS));
  assert.deepEqual(report.perMap, [{ label: "weapons", space: CURATED_KEY_SPACES.BARE, entries: 37 }]);
  assert.equal(report.total, 37);
  assert.deepEqual(report.problems, []);

  // The discovery index, rather than a shared registry literal, publishes the
  // production map. Other D-ticket maps may also be present after integration.
  assert.ok(curatedIconRegistry().maps.some((map) => map === WEAPON_ICONS));
  for (const source of [undefined, "core", "WR", "Cursed Scroll #3"]) {
    assert.equal(
      resolveCuratedIcon({ name: "Bastard Sword", source }, registry),
      registry.bare.get(curatedNameKey("Bastard Sword")),
      String(source),
    );
  }
});

test("the real inventory rejects a valid-looking absent weapon path", () => {
  const missingPath = "icons/weapons/swords/d1-valid-looking-but-absent-20260830.webp";
  assert.equal(pathExists(missingPath), false, "the negative fixture must not exist in Foundry");

  const drift = defineCuratedIconMap("weapons-drift-fixture", {
    "D1 drift sentinel": missingPath,
  }, { space: CURATED_KEY_SPACES.BARE });
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([drift]), { pathExists });

  assert.deepEqual(report.problems, [{
    map: "weapons-drift-fixture",
    kind: "missing-path",
    detail: `d1 drift sentinel → ${JSON.stringify(missingPath)}`,
  }]);
});

test("every mapped weapon gets curated art on a fresh/default import", () => {
  for (const [name, expectedImg] of WEAPON_ICONS.entries) {
    const data = buildItemData({ name, type: "Weapon" });
    assert.equal(data.img, expectedImg, name);
    assert.equal(data.flags[MODULE_ID].art.state, ART_STATES.CURATED, `${name} provenance`);
    assert.equal(data.flags[MODULE_ID].art.img, expectedImg, `${name} witness`);
  }
});

test("an enabled map upgrades an untouched curated pick, but not GM-custom art", () => {
  const mapsBefore = snapshotLiveMaps();
  try {
    _resetCuratedIconMaps();
    const first = registerCuratedIconMap("weapons-v1", {
      "Bastard sword": "icons/weapons/swords/sword-guard.webp",
    }, { space: CURATED_KEY_SPACES.BARE });
    const stored = buildItemData({ name: "Bastard sword", type: "Weapon" });
    assert.equal(stored.flags[MODULE_ID].art.state, ART_STATES.CURATED);

    _resetCuratedIconMaps();
    registerCuratedIconMap("weapons-v2", {
      "Bastard sword": "icons/weapons/swords/greatsword-crossguard-steel.webp",
    }, { space: CURATED_KEY_SPACES.BARE });
    const upgraded = buildItemData({ name: "Bastard sword", type: "Weapon" });
    preserveCuratedFields(upgraded, stored, { generatedArtifact: false });
    assert.equal(upgraded.img, "icons/weapons/swords/greatsword-crossguard-steel.webp");
    assert.equal(upgraded.flags[MODULE_ID].art.state, ART_STATES.CURATED);
    assert.equal(first.entries.size, 1);

    const gmArt = "world/abletodestroy/art/my-bastard-sword.webp";
    const custom = {
      name: "Bastard sword",
      type: "Weapon",
      img: gmArt,
      flags: { [MODULE_ID]: { art: { state: ART_STATES.CUSTOM, img: gmArt } } },
      system: {},
    };
    const customPayload = buildItemData({ name: "Bastard sword", type: "Weapon" });
    preserveCuratedFields(customPayload, custom, { generatedArtifact: false });
    assert.equal(customPayload.img, gmArt);
    assert.equal(customPayload.flags[MODULE_ID].art.state, ART_STATES.CUSTOM);
  } finally {
    restoreLiveMaps(mapsBefore);
  }
});

test("an unmapped weapon keeps the generic default fallback", () => {
  const name = "D1 Unmapped Weapon Sentinel";
  const data = buildItemData({ name, type: "Weapon" });
  assert.equal(data.img, defaultItemImg({ name, type: "Weapon" }));
  assert.equal(data.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
  assert.equal(WEAPON_ICONS.entries.has(curatedNameKey(name)), false);
});

test("enabling the map does not reclassify an already stamped Item", () => {
  const mapsBefore = snapshotLiveMaps();
  try {
    _resetCuratedIconMaps();
    const stamped = buildItemData({
      name: "Bastard sword",
      type: "Weapon",
      img: "icons/weapons/swords/sword-guard.webp",
    });
    assert.equal(stamped.flags[MODULE_ID].art.state, ART_STATES.IMPORTED);

    registerCuratedIconMap("weapons", Object.fromEntries(WEAPON_ICONS.entries), { space: CURATED_KEY_SPACES.BARE });
    assert.equal(
      classifyArt(stamped, { moduleDefaultImg: defaultItemImg(stamped) }),
      ART_STATES.IMPORTED,
    );
  } finally {
    restoreLiveMaps(mapsBefore);
  }
});
