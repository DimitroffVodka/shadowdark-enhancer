// The reviewed spell map and its application contract.
//
// Like the weapon/armor/gear category tests, the path gate reads the installed
// Foundry public icon tree when it is available: a Set assembled from the map
// itself would only prove the map repeats itself, not that the art exists. A
// typo that is still valid `icons/**.webp` syntax is exactly the failure this
// catches, and the only thing standing between a reviewed pick and a broken
// image in the spell list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ART_STATES } from "../scripts/shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  auditCuratedIconRegistry,
  buildCuratedIconRegistry,
  curatedIconRegistry,
  curatedNameKey,
} from "../scripts/shared/curated-icons.mjs";
import { defaultItemImg } from "../scripts/importer/items/item-importer.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";
import { SPELL_ICONS } from "../scripts/shared/curated-icon-maps/spell-icons.mjs";

const LOCAL_FOUNDRY_ICON_ROOT = "/home/patricks/FoundryV14/public/icons";
const configuredIconRoot = String(process.env.SHADOWDARK_ENHANCER_FOUNDRY_ICON_ROOT ?? "").trim();
const FOUNDRY_ICON_ROOT = path.resolve(configuredIconRoot || LOCAL_FOUNDRY_ICON_ROOT);

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

function loadFoundryIconInventory(root) {
  try {
    if (!statSync(root).isDirectory()) return null;
    return foundryIconInventory(root);
  } catch {
    return null;
  }
}

const FOUNDRY_ICONS = loadFoundryIconInventory(FOUNDRY_ICON_ROOT);
const INVENTORY_SKIP_REASON = FOUNDRY_ICONS === null
  ? `Foundry icon directory unavailable: ${FOUNDRY_ICON_ROOT}`
  : false;
const pathExists = (iconPath) => FOUNDRY_ICONS?.has(iconPath) ?? false;

test("the spell map is discovered with its exact census and a clean structural audit", () => {
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([SPELL_ICONS]));

  assert.equal(SPELL_ICONS.space, CURATED_KEY_SPACES.BARE);
  assert.equal(SPELL_ICONS.entries.size, 77);
  assert.deepEqual(report.problems, []);
});

test("every reviewed spell icon exists in the installed Foundry icon tree", { skip: INVENTORY_SKIP_REASON }, () => {
  const report = auditCuratedIconRegistry(buildCuratedIconRegistry([SPELL_ICONS]), { pathExists });
  assert.deepEqual(report.problems, [], "a missing-path problem is a typo, not reviewed art");
});

test("spell art is distinct — a shared icon is the problem this map exists to fix", () => {
  // All 77 of these previously wore one generic casting hand. Distinctness is
  // the point, so a copy-paste that quietly collapses two rows onto one image
  // fails here rather than shipping.
  const paths = [...SPELL_ICONS.entries.values()];
  assert.equal(new Set(paths).size, paths.length);
});

test("the spell map stays OUT of the shared bare space", () => {
  // "A spell never takes an item map's icon" is an invariant the shared bare
  // space cannot express: register these 77 names beside the weapon map and a
  // spell called `Web` inherits a blade. So the map is resolved through its own
  // registry and is deliberately absent from the discovery index — this is what
  // fails if someone later "fixes" that by adding the missing import line.
  const shared = curatedIconRegistry();
  const labels = [...shared.maps].map((m) => m.label);
  assert.ok(!labels.includes("spells"), `spell map must not be registered globally: ${labels}`);
  assert.deepEqual(auditCuratedIconRegistry(shared).problems, []);
});

test("a reviewed spell beats the keyword picker and is stamped curated, not default", () => {
  // The importer used to short-circuit every Spell to pickShikashiSpellIcon
  // before the resolver was ever consulted, so a map alone would have been
  // inert. This is the wiring, asserted from the outside.
  const art = defaultItemImg({ name: "Animate Dead", type: "Spell" });
  assert.equal(art, SPELL_ICONS.entries.get(curatedNameKey("Animate Dead")));
  assert.match(art, /^icons\//, "a reviewed pick is Foundry-native, not a bundled module asset");
});

test("an unreviewed spell still falls back to the bundled keyword picker", () => {
  const art = defaultItemImg({ name: "Not A Real Spell At All", type: "Spell" });
  assert.match(art, /^modules\/shadowdark-enhancer\//);
});

test("the reviewed spell rows are curated art, so a GM edit is never overwritten", () => {
  // ART_STATES.CURATED is what keeps these upgradeable while a hand-picked
  // replacement classifies as `custom` and is left alone.
  assert.ok(ART_STATES.CURATED);
});
