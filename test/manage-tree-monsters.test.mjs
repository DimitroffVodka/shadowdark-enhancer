import { test } from "node:test";
import assert from "node:assert/strict";
import { _testBuildMonsters } from "../scripts/importer/manage-tree.mjs";
import { selectMountDrafts } from "../scripts/importer/boats/mount-parser.mjs";

const actor = (name, source) => ({ name, source });

test("Monsters tree keeps curated bestiaries and reconciles mounts across sources", () => {
  const rows = [
    { label: "CORE", missingNames: ["City Watch"] },
    { label: "Custom", missingNames: ["Canoe"] },
    { label: "Western Reaches", missingNames: [] },
  ];
  const actors = [
    actor("Camel, Silver", "Cursed Scroll 2"),
    actor("Donkey", "Cursed Scroll 2"),
    actor("Horse, War", "Cursed Scroll 2"),
    actor("Pony", "Western Reaches"),
    actor("Scrag", "Cursed Scroll 2"),
    actor("Scrag, War", "Cursed Scroll 2"),
    actor("Canoe", null),
    actor("Moose", "Western Reaches"),
  ];

  const tree = _testBuildMonsters(rows, actors);
  assert.deepEqual(tree.children.map((node) => node.id), [
    "monsters/CS1", "monsters/CS2", "monsters/CS3",
    "monsters/CS4", "monsters/CS5", "monsters/CS6",
    "monsters/GMWR", "monsters/mounts",
  ]);

  const mounts = tree.children.at(-1);
  assert.equal(mounts.have, 6);
  assert.equal(mounts.locked, 1);
  assert.deepEqual(
    mounts.entries.filter((entry) => !entry.present).map((entry) => entry.name),
    ["Horse, Prized"],
  );
});

const leafOf = (tree, id) => tree.children.find((node) => node.id === id);
const bulkRow = (node) => node.entries.find((entry) => entry.type === "Actor");

// 57 of the GM Guide's 90 statblocks reprint a Cursed Scroll, spelled the same
// in both books, and the importer's duplicate check is global by name. With
// presence counted per book, importing a reprint from ONE book left the other
// book's row below its count for good: "Import everything" re-ran that row on
// every pass and skipped every monster on it as a duplicate.
test("a reprint imported from either book satisfies both bestiary rows", () => {
  const fromGuide = _testBuildMonsters([], [actor("Tar Bat", "Western Reaches GM Guide")]);
  assert.equal(leafOf(fromGuide, "monsters/CS1").have, 1);
  assert.equal(leafOf(fromGuide, "monsters/CS1").locked, 13);
  assert.equal(leafOf(fromGuide, "monsters/GMWR").have, 1);

  const fromScroll = _testBuildMonsters([], [actor("Tar Bat", "CS1")]);
  assert.equal(leafOf(fromScroll, "monsters/GMWR").have, 1);
  assert.equal(leafOf(fromScroll, "monsters/GMWR").locked, 89);
  assert.equal(leafOf(fromScroll, "monsters/CS1").have, 1);
});

test("a bestiary row disappears once every name in the book is present", () => {
  const CS5 = ["Bezelak", "Dremir", "Librarian of Leng", "Nuln", "Morzo Moth", "Wendel"];
  const short = leafOf(_testBuildMonsters([], CS5.slice(1).map((n) => actor(n, "CS5"))), "monsters/CS5");
  assert.equal(short.locked, 1);
  assert.match(bulkRow(short).name, /Import the CS5 bestiary — 6 monsters \(34-35\)/);

  // Imported from the GM Guide instead — the CS5 row is satisfied all the same.
  const full = leafOf(_testBuildMonsters([], CS5.map((n) => actor(n, "GMWR"))), "monsters/CS5");
  assert.equal(full.have, 6);
  assert.equal(full.locked, 0);
  assert.equal(bulkRow(full), undefined, "no Import row left to re-run");
});

test("the GM Guide row carries GMWR, and Western Reaches mounts/boats don't count for it", () => {
  const tree = _testBuildMonsters([], [actor("Canoe", "Western Reaches"), actor("Moose", "Western Reaches")]);
  const guide = leafOf(tree, "monsters/GMWR");
  assert.equal(guide.label, "GM Guide");
  assert.equal(guide.have, 0, "a boat filed under Western Reaches is not a bestiary monster");
  assert.equal(guide.locked, 90);
  // Without an explicit src the seed inherits the LABEL, which no source PDF
  // answers to — the row would be permanently blocked at "Grab from PDF".
  assert.equal(bulkRow(guide).src, "GMWR");
  assert.equal(bulkRow(guide).pages, "284-309");
});

test("a mount imported under the book's own heading still reconciles", () => {
  // The books print "WAR HORSE" where the manifest indexes "Horse, War". An
  // exact-name census left such an actor unreconciled: the row stayed locked,
  // kept offering Import, and the retry was skipped as a duplicate.
  const tree = _testBuildMonsters([], [
    actor("War Horse", "Western Reaches"),
    actor("Silver Camel", "Western Reaches"),
  ]);
  const mounts = tree.children.at(-1);
  assert.deepEqual(
    mounts.entries.filter((entry) => entry.present).map((entry) => entry.name),
    ["Camel, Silver", "Horse, War"],
  );
  assert.equal(mounts.locked, 5);
});

test("a same-stem mount doesn't satisfy another mount's row", () => {
  const tree = _testBuildMonsters([], [actor("Camel", "Core")]);
  const mounts = tree.children.at(-1);
  assert.equal(mounts.entries.find((entry) => entry.name === "Camel, Silver").present, false);
  assert.equal(mounts.locked, 7);
});

test("a mount unlock keeps only its selected draft from the full WR spread", () => {
  const parsed = ["Camel", "Horse, Prized", "Horse, War"].map((name) => ({
    draft: { name }, warnings: [],
  }));

  assert.deepEqual(
    selectMountDrafts(parsed, "  horse,   prized ").map((entry) => entry.draft.name),
    ["Horse, Prized"],
  );
  assert.deepEqual(selectMountDrafts(parsed, "Missing Mount"), []);
});
