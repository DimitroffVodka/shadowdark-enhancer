import { test } from "node:test";
import assert from "node:assert/strict";
import { filterManageTree } from "../scripts/importer/importer-hub-manage.mjs";

/** A two-level slice of the shape buildManageTree() produces. */
const tree = () => [{
  id: "char", label: "Character Content", locked: 2, children: [
    {
      id: "char/ancestries", label: "Ancestries", locked: 1, entries: [
        { name: "Kobold", present: false, src: "CS4", pages: "12" },
        { name: "Elf", present: true, src: "CORE", pages: "18" },
      ],
    },
    {
      id: "char/backgrounds", label: "Backgrounds", locked: 1, entries: [
        { name: "Urchin", present: false, src: "WR", pages: "74-77" },
      ],
    },
  ],
}];

const names = (nodes) => nodes.flatMap((n) => [
  ...(n.entries ?? []).map((e) => e.name), ...names(n.children ?? []),
]);

test("a query keeps matching entries and prunes the branches with none", () => {
  const out = filterManageTree(tree(), { query: "kobold" });
  assert.deepEqual(out[0].children.map((c) => c.id), ["char/ancestries"]);
  assert.deepEqual(names(out), ["Kobold"]);
});

test("the query also matches a row's book and page cite", () => {
  assert.deepEqual(names(filterManageTree(tree(), { query: "wr" })), ["Urchin"]);
  assert.deepEqual(names(filterManageTree(tree(), { query: "74-77" })), ["Urchin"]);
});

test("a folder whose label matches keeps everything under it", () => {
  const out = filterManageTree(tree(), { query: "ancestries" });
  assert.deepEqual(names(out), ["Kobold", "Elf"]);
});

test("search and the locked/imported filter both have to pass", () => {
  assert.deepEqual(names(filterManageTree(tree(), { query: "ancestries", filter: "imported" })), ["Elf"]);
  assert.deepEqual(filterManageTree(tree(), { query: "kobold", filter: "imported" }), []);
});

test("a live query expands the survivors without touching the GM's expand set", () => {
  const expanded = new Set();
  const out = filterManageTree(tree(), { query: "kobold", expanded });
  assert.equal(out[0].expanded, true);
  assert.equal(out[0].children[0].expanded, true);
  assert.equal(expanded.size, 0);
  // No query: the expand state is the GM's, as before.
  assert.equal(filterManageTree(tree(), { expanded })[0].expanded, false);
});

test("no query and no filter leaves the tree whole and unmutated", () => {
  const source = tree();
  const out = filterManageTree(source, {});
  assert.deepEqual(names(out), ["Kobold", "Elf", "Urchin"]);
  assert.deepEqual(source, tree());
});

test("fillable counts the imported patron rows still offering Fill description", () => {
  const nodes = [{ id: "char/patrons/boons", label: "Boons", locked: 1, entries: [
    { name: "Patron Boons: Freya", present: true, fillDesc: true },
    { name: "Patron Boons: Loki", present: true, fillDesc: false },
    { name: "Patron Boons: Odin", present: false },
  ] }];
  assert.equal(filterManageTree(nodes)[0].fillable, 1);
  assert.equal(filterManageTree(nodes, { filter: "locked" })[0].fillable, 0);
});

test("rows a module update added are stamped, and the New filter shows only them", () => {
  const fresh = new Set(["char/ancestries::Kobold", "char/ancestries::Elf"]);
  assert.deepEqual(names(filterManageTree(tree(), { filter: "new", fresh })), ["Kobold"]);
  const [kobold] = filterManageTree(tree(), { fresh })[0].children[0].entries;
  assert.equal(kobold.isNew, true);
  // Elf is in the fresh set but already imported: nothing to unlock, no badge.
  const elf = filterManageTree(tree(), { fresh })[0].children[0].entries[1];
  assert.equal(elf.isNew, undefined);
});

test("without a fresh set nothing is stamped and the New filter is empty", () => {
  assert.deepEqual(filterManageTree(tree(), { filter: "new" }), []);
  assert.equal(filterManageTree(tree())[0].children[0].entries[0].isNew, undefined);
});
