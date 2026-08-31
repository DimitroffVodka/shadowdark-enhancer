/**
 * A7/#57–#59 — precise loot-row resolution.
 *
 * The governing failure is #58: "Unopened bottle of exceptionally potent
 * Murgazi wine" resolved to the plain system `Bottle` because the old matcher
 * asked whether the row CONTAINED a known name. These fixtures pin the four
 * outcomes — exact, alias, ambiguous, and the false positives that must now be
 * refused — plus the callers that read the result.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  LOOT_MATCH, stripPrice, matchQuery, lootNameKey, lootAliasKey, lootAliasKeys,
  buildLootNameIndex, resolveLootItem, isResolvedLootMatch,
} from "../scripts/loot/loot-resolution.mjs";
import { findLink, buildItemIndex, invalidate } from "../scripts/loot/loot-linker.mjs";
import { classifyEntry } from "../scripts/loot/loot-pack.mjs";

/** A slice of the system gear pack shaped like `buildItemIndex` output. */
const item = (name, id = name.toLowerCase().replace(/\W+/g, "-")) => ({
  uuid: `Compendium.shadowdark.gear.Item.${id}`,
  name,
  nameLower: name.toLowerCase(),
});

const GEAR = [
  item("Bottle", "bGrhQMkhE2qwjL4j"),   // the real uuid #58 landed on
  item("Flask"),
  item("Bolt"),
  item("Rope, 60'"),
  item("Dagger"),
  item("Torch"),
  item("Iron spikes (10)"),
  item("Crawling Kit"),
  item("Holy Symbol"),
];

describe("loot resolution — the #58 false positives", () => {
  const ROWS = [
    ["Unopened bottle of exceptionally potent Murgazi wine (25 gp)", "Bottle"],
    ["A flask of exceptionally fine oil (5 gp)", "Flask"],
    ["Bolt of shimmering foreign silk (50 gp)", "Bolt"],
    ["Coil of tarred rope taken from a wreck", "Rope, 60'"],
    ["A dagger-shaped scar carved into a bone idol (10 gp)", "Dagger"],
    ["Guttering torchlight sealed in glass", "Torch"],
  ];

  for (const [row, wrong] of ROWS) {
    test(`"${row.slice(0, 34)}…" does not resolve to ${wrong}`, () => {
      const hit = resolveLootItem(row, GEAR);
      assert.equal(hit.status, LOOT_MATCH.UNRESOLVED, `resolved to ${hit.name}`);
      assert.equal(findLink(row, GEAR), null);
    });
  }

  test("the exact #58 row keeps its own name and price when fabricated", () => {
    const row = "Unopened bottle of exceptionally potent Murgazi wine (25 gp)";
    const out = classifyEntry(row, GEAR);
    assert.equal(out.action, "create");
    assert.equal(out.itemData.name, "Unopened bottle of exceptionally potent Murgazi wine");
    assert.equal(out.itemData.system.cost.gp, 25);
  });

  test("a generic name is not reachable from ANY interior word", () => {
    // Every gear name, buried mid-phrase. None may resolve.
    for (const candidate of GEAR) {
      const row = `Ornate ${candidate.name.toLowerCase()} of the drowned earl (99 gp)`;
      assert.equal(resolveLootItem(row, GEAR).status, LOOT_MATCH.UNRESOLVED, row);
    }
  });
});

describe("loot resolution — exact tier", () => {
  test("a bare name resolves", () => {
    const hit = resolveLootItem("Dagger", GEAR);
    assert.equal(hit.status, LOOT_MATCH.EXACT);
    assert.equal(hit.name, "Dagger");
  });

  test("a priced row resolves on the stripped name", () => {
    const hit = resolveLootItem("Dagger (1 gp)", GEAR);
    assert.equal(hit.status, LOOT_MATCH.EXACT);
    assert.equal(hit.matched, "Dagger");
  });

  test("case and spacing fold", () => {
    assert.equal(resolveLootItem("  dagger  ", GEAR).status, LOOT_MATCH.EXACT);
    assert.equal(resolveLootItem("DAGGER", GEAR).status, LOOT_MATCH.EXACT);
  });

  test("a price stripPrice cannot reach in one pass still resolves EXACTLY", () => {
    // `stripPrice`'s price pattern is $-anchored, so a single pass cannot see a
    // price with "each" or a full stop behind it — both ordinary book wording.
    // `matchQuery` runs the strips to a fixed point so these land on the exact
    // tier; `stripPrice` itself stays byte-identical for fabricated names.
    for (const row of ["Dagger (1 gp) each", "Dagger (1 gp).", "Dagger (1 gp) each.", "Dagger."]) {
      assert.equal(matchQuery(row), "Dagger", row);
      const hit = resolveLootItem(row, GEAR);
      assert.equal(hit.status, LOOT_MATCH.EXACT, row);
      assert.equal(hit.name, "Dagger", row);
    }
  });

  test("a multi-word name with punctuation resolves exactly", () => {
    const hit = resolveLootItem("Rope, 60' (5 gp)", GEAR);
    assert.equal(hit.status, LOOT_MATCH.EXACT);
    assert.equal(hit.name, "Rope, 60'");
  });

  test("a curly apostrophe folds to the straight one", () => {
    assert.equal(resolveLootItem("Rope, 60′", GEAR).status, LOOT_MATCH.EXACT);
  });

  test("findLink reports the shape its six call sites read", () => {
    const link = findLink("Dagger (1 gp)", GEAR);
    assert.deepEqual(Object.keys(link).sort(), ["matched", "name", "uuid"]);
    assert.match(link.uuid, /^Compendium\./);
  });
});

describe("loot resolution — alias tier", () => {
  test("a plural resolves to its singular", () => {
    const hit = resolveLootItem("Torches (2 gp)", GEAR);
    assert.equal(hit.status, LOOT_MATCH.ALIAS);
    assert.equal(hit.name, "Torch");
  });

  test("a leading article and a leading count fold away", () => {
    assert.equal(resolveLootItem("A dagger", GEAR).status, LOOT_MATCH.ALIAS);
    assert.equal(resolveLootItem("The dagger", GEAR).status, LOOT_MATCH.ALIAS);
    assert.equal(resolveLootItem("2 daggers", GEAR).status, LOOT_MATCH.ALIAS);
  });

  test("a trailing non-price parenthetical folds away", () => {
    const hit = resolveLootItem("Iron spikes (steel-tipped)", GEAR);
    assert.equal(hit.status, LOOT_MATCH.ALIAS);
    assert.equal(hit.name, "Iron spikes (10)");
  });

  test("a word whose trailing s is not a plural is left alone", () => {
    for (const word of ["glass", "brass", "harness", "fungus", "lapis", "gorgeous"]) {
      assert.equal(lootAliasKey(word), word, word);
    }
  });

  test("the legacy single-key helper still returns the singular alias", () => {
    assert.equal(lootAliasKey("Axes"), "axe");
    assert.equal(lootAliasKey("2 daggers"), "dagger");
  });

  test("the fold is anchored — no candidate can shorten to an interior word", () => {
    const keys = lootAliasKeys("Unopened bottle of exceptionally potent Murgazi wines");
    assert.deepEqual(keys, [
      "unopened bottle of exceptionally potent murgazi wines",
      "unopened bottle of exceptionally potent murgazi wine",
    ]);
    for (const k of keys) assert.match(k, /^unopened bottle of exceptionally potent murgazi wines?$/);
  });
});

describe("loot resolution — ambiguity", () => {
  const AMBIGUOUS = [...GEAR, { uuid: "Compendium.world.x.Item.bolts", name: "Bolts" }];

  test("two items folding to one alias key resolve to neither", () => {
    const hit = resolveLootItem("3 bolts (2 gp)", AMBIGUOUS);
    assert.equal(hit.status, LOOT_MATCH.AMBIGUOUS);
    assert.deepEqual(hit.candidates.map((c) => c.name).sort(), ["Bolt", "Bolts"]);
    assert.equal(findLink("3 bolts (2 gp)", AMBIGUOUS), null);
  });

  test("an exact name still wins even when its alias fold is contested", () => {
    // "Bolts" is itself an item; the exact tier answers before the fold runs.
    assert.equal(resolveLootItem("Bolts", AMBIGUOUS).name, "Bolts");
  });

  test("an exact hit still wins over an ambiguous alias fold", () => {
    const hit = resolveLootItem("Bolt", AMBIGUOUS);
    assert.equal(hit.status, LOOT_MATCH.EXACT);
    assert.equal(hit.name, "Bolt");
  });

  test("two spellings of the same exact name are ambiguous, not first-wins", () => {
    const pair = [
      { uuid: "Compendium.a.b.Item.1", name: "Bandit’s Kit" },
      { uuid: "Compendium.a.b.Item.2", name: "Bandit's Kit" },
    ];
    assert.equal(resolveLootItem("Bandit's Kit", pair).status, LOOT_MATCH.AMBIGUOUS);
  });

  test("the same uuid reached twice is one answer, not a tie", () => {
    const dup = [item("Dagger"), item("Dagger")];
    assert.equal(resolveLootItem("Dagger", dup).status, LOOT_MATCH.EXACT);
  });
});

describe("loot resolution — plumbing", () => {
  test("empty and priceless-blank rows are unresolved, never a match", () => {
    for (const row of ["", "   ", null, undefined, "(5 gp)"]) {
      assert.equal(resolveLootItem(row, GEAR).status, LOOT_MATCH.UNRESOLVED);
    }
  });

  test("stripPrice is byte-identical to the fabricated-name contract", () => {
    assert.equal(stripPrice("Silver tooth (1 gp)"), "Silver tooth");
    assert.equal(stripPrice("Gem  shard (10 gp) each"), "Gem  shard (10 gp)");
    assert.equal(stripPrice("10 cp in a greasy pouch"), "10 cp in a greasy pouch");
    assert.equal(stripPrice("Bandit’s Kit"), "Bandit’s Kit");   // no folding
  });

  test("lootNameKey folds only case, spacing and apostrophes", () => {
    assert.equal(lootNameKey("  Bandit’s   KIT "), "bandit's kit");
  });

  test("a prebuilt index resolves identically to a raw list", () => {
    const index = buildLootNameIndex(GEAR);
    for (const row of ["Dagger (1 gp)", "Torches", "Murgazi wine in a bottle"]) {
      assert.deepEqual(resolveLootItem(row, index), resolveLootItem(row, GEAR), row);
    }
  });

  test("isResolvedLootMatch admits exactly the two linking tiers", () => {
    assert.equal(isResolvedLootMatch({ status: LOOT_MATCH.EXACT }), true);
    assert.equal(isResolvedLootMatch({ status: LOOT_MATCH.ALIAS }), true);
    assert.equal(isResolvedLootMatch({ status: LOOT_MATCH.AMBIGUOUS }), false);
    assert.equal(isResolvedLootMatch({ status: LOOT_MATCH.UNRESOLVED }), false);
    assert.equal(isResolvedLootMatch(null), false);
  });

  test("coins still classify as coins, before any name matching", () => {
    assert.equal(classifyEntry("120 gp in a rotted sack", GEAR).action, "coin");
  });
});

/**
 * The focused suites above hand `resolveLootItem` a raw array, which bypasses
 * the candidate set every real consumer actually gets. These go through the
 * production `buildItemIndex` — the layer that used to drop three-character
 * gear before the resolver ever saw it, so even an EXACT `Axe` query missed.
 */
describe("loot resolution — through the production item index", () => {
  const packEntry = (name, type = "Basic") => ({ _id: name.toLowerCase().replace(/\W+/g, ""), name, type });
  const fakePack = (collection, packageType, entries) => ({
    collection, documentName: "Item", packageType,
    metadata: { packageType },
    getIndex: async () => entries.map((e) => ({ ...e, uuid: `Compendium.${collection}.Item.${e._id}` })),
  });

  const SYSTEM = fakePack("shadowdark.gear", "system", [
    packEntry("Axe", "Weapon"), packEntry("Net"), packEntry("Bottle"), packEntry("Flask"),
    packEntry("Dagger", "Weapon"), packEntry("Torch"), packEntry("Rope, 60'"),
    packEntry("Oil, Flask"), packEntry("Ration"),
  ]);
  const WORLD = fakePack("world.shadowdark-enhancer--items", "world", [
    packEntry("Wagon"), packEntry("Ball Bearing"),
    packEntry("Dagger", "Weapon"),                    // same name as system — system must win
  ]);

  let index;
  before(async () => {
    globalThis.game = { packs: [WORLD, SYSTEM] };     // world listed first on purpose
    invalidate();
    index = await buildItemIndex();
  });
  after(() => { invalidate(); delete globalThis.game; });

  const via = (row) => resolveLootItem(row, index);

  test("three-character gear is in the index and resolves EXACTLY", () => {
    // The regression the review reproduced: MIN_NAME_LEN = 4 dropped both.
    for (const [row, want] of [["Axe", "Axe"], ["Net", "Net"], ["axe (5 gp)", "Axe"], ["Net.", "Net"]]) {
      const hit = via(row);
      assert.equal(hit.status, LOOT_MATCH.EXACT, `${row} → ${hit.status}`);
      assert.equal(hit.name, want, row);
    }
  });

  test("Axes resolves to Axe, not to the stemmer's 'ax'", () => {
    const hit = via("Axes (10 gp)");
    assert.equal(hit.status, LOOT_MATCH.ALIAS);
    assert.equal(hit.name, "Axe");
  });

  test("a price suffix behind sentence punctuation still resolves", () => {
    for (const row of ["Dagger (1 gp).", "Dagger (1 gp) each.", "Rope, 60' (5 gp)."]) {
      assert.ok(["exact", "alias"].includes(via(row).status), `${row} → ${via(row).status}`);
    }
  });

  test("the #58 refusals survive the widened index", () => {
    for (const row of [
      "Unopened bottle of exceptionally potent Murgazi wine (25 gp)",
      "A flask of exceptionally fine oil (5 gp)",
      "Coil of tarred rope taken from a wreck",
      "An axe-shaped birthmark on a dead man's shoulder",
    ]) {
      assert.equal(via(row).status, LOOT_MATCH.UNRESOLVED, row);
      assert.equal(findLink(row, index), null, row);
    }
  });

  test("system-first dedup still wins for a same-named world item", () => {
    assert.match(via("Dagger").uuid, /^Compendium\.shadowdark\.gear\./);
  });

  test("world-only items still resolve, exact and alias", () => {
    assert.equal(via("Wagon").status, LOOT_MATCH.EXACT);
    assert.equal(via("Ball Bearings").name, "Ball Bearing");
  });

  test("blank-named pack entries are excluded without a length floor", async () => {
    globalThis.game = { packs: [fakePack("world.x", "world", [
      packEntry("Axe", "Weapon"), { _id: "blank", name: "   ", type: "Basic" },
    ])] };
    invalidate();
    const idx = await buildItemIndex();
    assert.deepEqual(idx.map((e) => e.name), ["Axe"]);
  });
});
