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
    "monsters/mounts",
  ]);

  const mounts = tree.children.at(-1);
  assert.equal(mounts.have, 6);
  assert.equal(mounts.locked, 1);
  assert.deepEqual(
    mounts.entries.filter((entry) => !entry.present).map((entry) => entry.name),
    ["Horse, Prized"],
  );
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
