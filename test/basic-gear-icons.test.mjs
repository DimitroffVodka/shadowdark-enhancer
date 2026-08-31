// D3 — the complete N3 Basic Gear icon map.
//
// The map is intentionally tested as data: its 44 exact normalized names are
// pinned, aliases share their canonical art, and the A4 drift gate checks the
// real Foundry public icon tree rather than a Set assembled from the map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  ART_STATES,
  classifyArt,
  isArtUpgradeable,
} from "../scripts/shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  auditCuratedIconRegistry,
  buildCuratedIconRegistry,
  curatedIconRegistry,
  curatedNameKey,
  defineCuratedIconMap,
  isCuratedApplyTarget,
  resolveCuratedIcon,
} from "../scripts/shared/curated-icons.mjs";
import { buildItemData, defaultItemImg, preserveCuratedFields } from "../scripts/importer/items/item-importer.mjs";
import { BASIC_GEAR_ICONS } from "../scripts/shared/curated-icon-maps/gear-icons.mjs";
import "../scripts/shared/curated-icon-maps/index.mjs";

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

// The resolver/audit tests remain pure everywhere. Only the two assertions
// that need an on-disk inventory skip when this optional directory is absent.
const FOUNDRY_ICONS = loadFoundryIconInventory(FOUNDRY_ICON_ROOT);
const INVENTORY_SKIP_REASON = FOUNDRY_ICONS === null
  ? `Foundry icon directory unavailable: ${FOUNDRY_ICON_ROOT}`
  : false;
const pathExists = (iconPath) => FOUNDRY_ICONS?.has(iconPath) ?? false;

const EXPECTED_KEYS = [
  "arrows",
  "arrows (20)",
  "backpack",
  "ball bearing",
  "basilisk egg",
  "bottle",
  "caltrops",
  "caltrops (one bag)",
  "candle",
  "candle (3)",
  "charcoal, jar",
  "coin",
  "crawling kit",
  "crossbow bolts (20)",
  "crossbow bolts",
  "crowbar",
  "flash seed",
  "flask",
  "flint and steel",
  "gem",
  "glow paste, jar",
  "grappling hook",
  "holy symbol",
  "holy water, flask",
  "iron spikes (10)",
  "iron spikes",
  "lantern",
  "lantern hook",
  "miner's putty, jar",
  "mirror",
  "morzo silk rope",
  "rope, morzo silk",
  "net",
  "oil, flask",
  "pole",
  "rations (3)",
  "rations",
  "rope, 60'",
  "saddle",
  "tallow, jar",
  "thieves' tools",
  "torch",
  "traveler's lamp",
  "wagon",
];

const CANONICAL_KEYS = [
  "arrows",
  "backpack",
  "ball bearing",
  "basilisk egg",
  "bottle",
  "caltrops",
  "candle",
  "charcoal, jar",
  "coin",
  "crawling kit",
  "crossbow bolts",
  "crowbar",
  "flash seed",
  "flask",
  "flint and steel",
  "gem",
  "glow paste, jar",
  "grappling hook",
  "holy symbol",
  "holy water, flask",
  "iron spikes",
  "lantern",
  "lantern hook",
  "miner's putty, jar",
  "mirror",
  "morzo silk rope",
  "net",
  "oil, flask",
  "pole",
  "rations",
  "rope, 60'",
  "saddle",
  "tallow, jar",
  "thieves' tools",
  "torch",
  "traveler's lamp",
  "wagon",
];

const ALIASES = {
  "arrows (20)": "arrows",
  "caltrops (one bag)": "caltrops",
  "candle (3)": "candle",
  "crossbow bolts (20)": "crossbow bolts",
  "iron spikes (10)": "iron spikes",
  "rope, morzo silk": "morzo silk rope",
  "rations (3)": "rations",
};

test("Basic Gear map is the exact 44-row bare-name census", () => {
  assert.equal(BASIC_GEAR_ICONS.label, "basic-gear");
  assert.equal(BASIC_GEAR_ICONS.space, CURATED_KEY_SPACES.BARE);
  assert.deepEqual([...BASIC_GEAR_ICONS.problems], []);
  assert.deepEqual([...BASIC_GEAR_ICONS.entries.keys()].sort(), [...EXPECTED_KEYS].sort());
  assert.equal(BASIC_GEAR_ICONS.entries.size, 44);
  assert.equal(CANONICAL_KEYS.length, 37);
  assert.equal(Object.keys(ALIASES).length, 7);
  assert.equal(CANONICAL_KEYS.length + Object.keys(ALIASES).length, 44);
});

test("quantity and spelling variants remain aliases, not extra canonical gear", () => {
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    assert.ok(BASIC_GEAR_ICONS.entries.has(alias), `${alias} is present`);
    assert.ok(CANONICAL_KEYS.includes(canonical), `${canonical} is canonical`);
    assert.equal(
      BASIC_GEAR_ICONS.entries.get(alias),
      BASIC_GEAR_ICONS.entries.get(canonical),
      `${alias} keeps the canonical icon`,
    );
  }
  assert.deepEqual(
    EXPECTED_KEYS.filter((key) => !Object.hasOwn(ALIASES, key)).sort(),
    [...CANONICAL_KEYS].sort(),
  );
});

test("A4 discovery registration exposes Basic Gear through the live registry", () => {
  const registry = curatedIconRegistry();
  assert.match(
    readFileSync(path.resolve("scripts/shared/curated-icon-maps/index.mjs"), "utf8"),
    /import ["']\.\/gear-icons\.mjs["'];/,
  );
  assert.ok(registry.maps.includes(BASIC_GEAR_ICONS));
  assert.equal(registry.bare.get("arrows"), "icons/weapons/ammunition/arrows-broadhead-white.webp");
  assert.equal(registry.bare.get("traveler's lamp"), "icons/sundries/lights/lantern-bullseye-signal-copper.webp");
});

test("Basic Gear names are source-agnostic bare-space lookups", () => {
  const registry = buildCuratedIconRegistry([BASIC_GEAR_ICONS]);
  for (const key of EXPECTED_KEYS) {
    const expected = BASIC_GEAR_ICONS.entries.get(key);
    for (const source of [undefined, "Core", "Western Reaches", "Cursed Scroll #3"]) {
      assert.equal(resolveCuratedIcon({ name: key, source }, registry), expected, `${key} / ${source}`);
    }
  }
});

test("A4 audit covers all 44 rows against the real Foundry icon inventory", { skip: INVENTORY_SKIP_REASON }, () => {
  assert.ok(FOUNDRY_ICONS.size > 1_000, "the path predicate must use the real Foundry icon inventory");
  const registry = buildCuratedIconRegistry([BASIC_GEAR_ICONS]);
  const report = auditCuratedIconRegistry(registry, { pathExists });

  assert.equal(report.total, 44);
  assert.equal(report.bare, 44);
  assert.equal(report.sourced, 0);
  assert.deepEqual(report.perMap, [{ label: "basic-gear", space: "bare", entries: 44 }]);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(
    [...registry.bare.keys()].sort(),
    EXPECTED_KEYS.map((name) => curatedNameKey(name)).sort(),
  );
});

test("A4 audit reports a valid-looking but absent path as missing-path", { skip: INVENTORY_SKIP_REASON }, () => {
  const missingPath = "icons/__d3_missing_asset_probe__/valid-looking.webp";
  assert.equal(pathExists(missingPath), false);
  const broken = defineCuratedIconMap("basic-gear-missing-probe", {
    "Missing Basic Gear": missingPath,
  }, { space: CURATED_KEY_SPACES.BARE });
  const report = auditCuratedIconRegistry(
    buildCuratedIconRegistry([BASIC_GEAR_ICONS, broken]),
    { pathExists },
  );

  assert.ok(report.problems.some((problem) =>
    problem.map === "basic-gear-missing-probe"
    && problem.kind === "missing-path"
    && problem.detail === `missing basic gear → ${JSON.stringify(missingPath)}`));
});

test("fresh Basic Gear import receives curated art and curated provenance", () => {
  const data = buildItemData({ name: "Arrows", type: "Basic" });
  const expected = BASIC_GEAR_ICONS.entries.get("arrows");
  assert.equal(data.img, expected);
  assert.equal(data.flags[MODULE_ID].art.state, ART_STATES.CURATED);
  assert.equal(data.flags[MODULE_ID].art.img, expected);
  assert.equal(isArtUpgradeable(data), true);
});

test("a revised Basic Gear map upgrades an older curated witness", () => {
  const current = BASIC_GEAR_ICONS.entries.get("arrows");
  const old = "icons/weapons/ammunition/arrows-old-curated.webp";
  const existing = {
    name: "Arrows",
    type: "Basic",
    img: old,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.CURATED, img: old } } },
  };
  const payload = buildItemData({ name: "Arrows", type: "Basic" });

  preserveCuratedFields(payload, existing);

  assert.equal(payload.img, current);
  assert.deepEqual(payload.flags[MODULE_ID].art, { state: ART_STATES.CURATED, img: current });
});

test("GM-custom Basic Gear art survives a curated reimport", () => {
  const custom = "worlds/abletodestroy/art/my-arrows.webp";
  const existing = {
    name: "Arrows",
    type: "Basic",
    img: custom,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.CUSTOM, img: custom } } },
  };
  const payload = buildItemData({ name: "Arrows", type: "Basic" });

  preserveCuratedFields(payload, existing);

  assert.equal(payload.img, custom);
  assert.deepEqual(payload.flags[MODULE_ID].art, { state: ART_STATES.CUSTOM, img: custom });
  assert.equal(isArtUpgradeable(payload), false);
});

test("an unmapped Basic Gear name keeps the generic fallback", () => {
  const data = buildItemData({ name: "D3 Unmapped Basic Gear", type: "Basic" });
  assert.equal(data.img, defaultItemImg({ name: "D3 Unmapped Basic Gear", type: "Basic" }));
  assert.equal(data.flags[MODULE_ID].art.state, ART_STATES.DEFAULT);
  assert.notEqual(data.img, BASIC_GEAR_ICONS.entries.get("arrows"));
});

test("an already-stamped curated item stays curated after the map is enabled", () => {
  const current = BASIC_GEAR_ICONS.entries.get("arrows");
  const existing = {
    name: "Arrows",
    type: "Basic",
    img: current,
    flags: { [MODULE_ID]: { art: { state: ART_STATES.CURATED, img: current } } },
  };

  assert.equal(classifyArt(existing, { moduleDefaultImg: defaultItemImg(existing) }), ART_STATES.CURATED);
  assert.equal(isArtUpgradeable(existing, { moduleDefaultImg: defaultItemImg(existing) }), true);
});

test("the Basic Gear map remains outside the base-system write boundary", () => {
  assert.equal(isCuratedApplyTarget("world.shadowdark-enhancer--items"), true);
  assert.equal(isCuratedApplyTarget("shadowdark.gear"), false);
});
