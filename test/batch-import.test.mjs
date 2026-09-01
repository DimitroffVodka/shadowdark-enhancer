import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE, routeForEntry, jobKeyForEntry, collectLocked, planBatch, summarizeBatch,
} from "../scripts/importer/batch-import.mjs";

/** A Manage-tree entry, defaulted to a locked generic table unlock. */
const entry = (over = {}) => ({
  name: "Carousing Event", present: false, seedAction: "charSeedPaste",
  type: "Table", src: "CS1", pages: "30", ...over,
});

/** A leaf node holding `entries`. */
const leaf = (id, label, entries, children = []) => ({
  id, label, icon: "fa-x", entries, children,
  have: entries.filter((e) => e.present).length,
  locked: entries.filter((e) => !e.present).length,
});

test("each seedAction routes to the workspace its unlock already opens", () => {
  assert.equal(routeForEntry(entry()), ROUTE.HUB);
  assert.equal(routeForEntry(entry({ type: "Background" })), ROUTE.HUB);
  assert.equal(routeForEntry(entry({ type: "Mount" })), ROUTE.HUB);
  assert.equal(routeForEntry(entry({ type: "Boat" })), ROUTE.HUB);
  assert.equal(routeForEntry(entry({ seedAction: "monsterSeedPaste", type: "Actor" })), ROUTE.HUB);
  assert.equal(routeForEntry(entry({ type: "Class" })), ROUTE.CLASS);
  assert.equal(routeForEntry(entry({ type: "Basic" })), ROUTE.GEAR);
  assert.equal(routeForEntry(entry({ type: "Weapon" })), ROUTE.GEAR);
  assert.equal(routeForEntry(entry({ seedAction: "spellListSeed", listKey: "wr-priest-lawful" })), ROUTE.SPELLS);
  assert.equal(routeForEntry(entry({ seedAction: "downtimeSeedPaste", listKey: "cs6" })), ROUTE.DOWNTIME);
});

test("rows with no automated route are reported, never silently dropped", () => {
  // An item census gap carries a name and nothing else — there is no page to
  // grab, so a batch must hand it back rather than invent a paste.
  const gap = entry({ seedAction: "itemSeedPaste", type: "Basic", src: "", pages: "" });
  assert.equal(routeForEntry(gap), null);

  const plan = planBatch([leaf("items", "Items", [gap])]);
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.blocked.length, 1);
  assert.match(plan.blocked[0].reason, /page citation/i);
  assert.equal(plan.lockedCount, 1);
});

test("rows unlocked by one press collapse into a single job", () => {
  // Clicking any CS1 monster grabs the whole bestiary spread and commits every
  // statblock on it; fourteen rows must not mean fourteen identical grabs.
  const monsters = ["Zombie", "Ghoul", "Wight"].map((name) =>
    entry({ name, seedAction: "monsterSeedPaste", type: "Actor", src: "CS1", pages: "46-48" }));
  const boats = ["Canoe", "Longship"].map((name) =>
    entry({ name, type: "Boat", src: "WR", pages: "118" }));
  const gear = ["Torch", "Rope"].map((name) =>
    entry({ name, type: "Basic", src: "WR", pages: "106" }));

  const plan = planBatch([leaf("mixed", "Mixed", [...monsters, ...boats, ...gear])]);
  assert.equal(plan.jobs.length, 3);
  assert.deepEqual(plan.jobs.map((j) => j.covers.length), [3, 2, 2]);
  assert.equal(plan.lockedCount, 7);
});

test("Mounts sharing a spread batch together while seeded tables stay separate", () => {
  // A normal Mount unlock selects its own statblock, but the batch-only Mount
  // route carries every covered name into that same parser. Seeded tables still
  // keep one identity per unlock — collapsing either table would mark the rest
  // done without importing them.
  const mounts = ["Donkey", "Horse, War"].map((name) =>
    entry({ name, type: "Mount", src: "WR", pages: "116-117" }));
  const tables = ["Dwarf Trinket", "Elf Trinket"].map((name) =>
    entry({ name, type: "Table", src: "WR", pages: "20" }));

  const plan = planBatch([leaf("wr", "Western Reaches", [...mounts, ...tables])]);
  assert.equal(plan.jobs.length, 3);
  assert.deepEqual(plan.jobs.map((j) => j.covers.length), [2, 1, 1]);
  assert.equal(plan.jobs[0].key, "mount:WR:116-117");
});

test("Mount bulk routing stays distinct from Boat and ordinary monster spreads", () => {
  const mounts = ["Donkey", "Pony"].map((name) =>
    entry({ name, type: "Mount", src: "WR", pages: "116-117" }));
  const boats = ["Canoe", "Longship"].map((name) =>
    entry({ name, type: "Boat", src: "WR", pages: "118" }));
  const monsters = ["Zombie", "Ghoul"].map((name) =>
    entry({ name, seedAction: "monsterSeedPaste", type: "Actor", src: "CS1", pages: "46-48" }));

  const plan = planBatch([leaf("mixed", "Mixed", [...mounts, ...boats, ...monsters])]);
  assert.deepEqual(plan.jobs.map((job) => job.key), [
    "mount:WR:116-117", "boat:WR:118", "actor:CS1:46-48",
  ]);
  assert.deepEqual(plan.jobs.map((job) => job.covers.length), [2, 2, 2]);
  assert.ok(plan.jobs.every((job) => job.route === ROUTE.HUB));
});

test("same-named entries from different books are different jobs", () => {
  const plan = planBatch([leaf("t", "Tables", [
    entry({ name: "Carousing Event", src: "CS1", pages: "30" }),
    entry({ name: "Carousing Event", src: "CS6", pages: "24" }),
  ])]);
  assert.equal(plan.jobs.length, 2);
});

test("same-named Core entries with different manifest identities are different jobs", () => {
  const plan = planBatch([leaf("core", "Core Rulebook", [
    entry({ name: "Wealth", src: "CORE", pages: "124", manifestId: "core-wealth-npc" }),
    entry({ name: "Wealth", src: "CORE", pages: "126", manifestId: "core-wealth-rival-crawlers" }),
  ])]);
  assert.equal(plan.jobs.length, 2);
  assert.deepEqual(plan.jobs.map((job) => job.entry.manifestId), [
    "core-wealth-npc", "core-wealth-rival-crawlers",
  ]);
});

test("already-imported rows are never planned", () => {
  const plan = planBatch([leaf("t", "Tables", [
    entry({ name: "Done", present: true }),
    entry({ name: "Pending" }),
  ])]);
  assert.equal(plan.lockedCount, 1);
  assert.deepEqual(plan.jobs.map((j) => j.label), ["Pending"]);
});

test("a blocked job blocks every row it would have covered", () => {
  // Three CS1 monsters share one grab. With no linked PDF the grab can't run —
  // and all three rows must carry the reason, not just the first.
  const monsters = ["Zombie", "Ghoul", "Wight"].map((name) =>
    entry({ name, seedAction: "monsterSeedPaste", type: "Actor", src: "CS1", pages: "46-48" }));
  const plan = planBatch([leaf("m", "Monsters", monsters)], {
    canRun: () => "Cursed Scroll 1's PDF isn't linked",
  });
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.blocked.length, 3);
  assert.ok(plan.blocked.every((b) => /isn't linked/.test(b.reason)));
});

test("a run scoped to a folder ignores everything outside it", () => {
  const tree = [{
    id: "char", label: "Character Content", icon: "fa-x", entries: [], have: 0, locked: 2,
    children: [
      leaf("char/backgrounds", "Backgrounds", [entry({ name: "WR Backgrounds", type: "Table" })]),
      leaf("char/ancestries", "Ancestries", [entry({ name: "Dwarf Names", type: "Table" })]),
    ],
  }, leaf("items", "Items", [entry({ name: "Torch", type: "Basic", src: "WR" })])];

  assert.deepEqual(
    planBatch(tree, { rootId: "char/backgrounds" }).jobs.map((j) => j.label),
    ["WR Backgrounds"]);
  // A branch id scopes to everything beneath it.
  assert.equal(planBatch(tree, { rootId: "char" }).jobs.length, 2);
  assert.equal(planBatch(tree).jobs.length, 3);
  // An id that isn't in the tree plans nothing rather than the whole library.
  assert.equal(planBatch(tree, { rootId: "nope" }).jobs.length, 0);
});

test("collectLocked stamps the folder path each row was found in", () => {
  const tree = [{
    id: "char", label: "Character Content", icon: "fa-x", entries: [], have: 0, locked: 1,
    children: [leaf("char/ancestries/names", "Names", [entry({ name: "Dwarf Names" })])],
  }];
  assert.equal(collectLocked(tree)[0].path, "Character Content › Names");
});

test("jobKeyForEntry keys a spell list by its list key, not its label", () => {
  const a = entry({ name: "Priest · Lawful", seedAction: "spellListSeed", listKey: "wr-priest-lawful" });
  const b = entry({ name: "Priest (Lawful)", seedAction: "spellListSeed", listKey: "wr-priest-lawful" });
  assert.equal(jobKeyForEntry(a), jobKeyForEntry(b));
});

test("summarizeBatch buckets outcomes and totals the documents created", () => {
  const job = (label) => ({ label, key: label, route: ROUTE.HUB, covers: [], entry: entry() });
  const summary = summarizeBatch([
    { job: job("Carousing"), status: "created", created: 1, note: "1 created" },
    { job: job("CS1 bestiary"), status: "created", created: 14, note: "14 created" },
    { job: job("Boats"), status: "nothing", created: 0, note: "already in your library" },
    { job: job("Bard"), status: "failed", created: 0, note: "no talent table" },
    { job: job("Duelist"), status: "cancelled", created: 0, note: "stopped" },
  ], [{ entry: entry({ name: "Torch" }), reason: "no page citation" }]);

  assert.equal(summary.jobs, 5);
  assert.equal(summary.documents, 15);
  assert.deepEqual(
    [summary.created, summary.nothing, summary.failed, summary.cancelled, summary.blocked],
    [2, 1, 1, 1, 1]);
  // Every row reaches the report, blocked ones included.
  assert.equal(summary.lines.length, 6);
  assert.deepEqual(summary.lines.at(-1), { status: "blocked", name: "Torch", note: "no page citation" });
});

test("summarizeBatch expands a bulk job into explicit per-entry outcomes", () => {
  const job = { label: "Donkey", key: "mount:WR:116-117", route: ROUTE.HUB };
  const summary = summarizeBatch([{
    job, status: "created", created: 2,
    entries: [
      { name: "Donkey", status: "created", created: 1, note: "created" },
      { name: "Horse, War", status: "nothing", created: 0, note: "already in your library" },
      { name: "Pony", status: "failed", created: 0, note: "not among the statblocks" },
    ],
  }]);

  assert.equal(summary.jobs, 1);
  assert.equal(summary.entries, 3);
  assert.equal(summary.documents, 1);
  assert.deepEqual(
    [summary.created, summary.nothing, summary.failed, summary.cancelled, summary.blocked],
    [1, 1, 1, 0, 0]);
  assert.deepEqual(summary.lines.map((line) => line.name), ["Donkey", "Horse, War", "Pony"]);
});

test("an unknown result status is counted as a failure, not dropped", () => {
  const summary = summarizeBatch([
    { job: { label: "Weird" }, status: "exploded", created: 0, note: "?" },
  ]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.jobs, 1);
});
