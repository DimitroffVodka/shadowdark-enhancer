/**
 * The wizard's Import page: the order of the stages, the numbers it reports, and what it hands back to the GM.
 * Every Foundry piece is a stub; what is tested is the flow and the sentences' arguments.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { runWizardImport } from "../scripts/importer/wizard/wizard-run.mjs";

const file = (name, mb = 1) => ({ name, size: Math.round(mb * 1048576) });
const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;

const stateWith = (...files) => {
  const s = newState();
  addFiles(s, files);
  s.check = { done: true, ready: [...Object.keys(s.books).map((id) => `book:${id}`), ...Object.keys(s.maps).map((id) => `map:${id}`)], problems: [], items: [] };
  s.uploaded = Object.fromEntries(Object.keys(s.maps).map((id) => [id, `adventure-maps/${id}.png`]));
  return s;
};
const CS1 = () => file("Cursed Scroll 1 - Diablerie V4-3.pdf", 16);
const MAP1 = () => file("Ruins of Bittermold Keep (68 wide x 44 high).png", 2.7);

/** Stand-ins that record what was asked, in order. */
const deps = (over = {}) => {
  const calls = [];
  return {
    calls, t,
    adventureBooks: ["CS1", "CS2"],
    library: async (o) => { calls.push("library"); o.onProgress(1, 2, "Monsters"); o.onProgress(2, 2, ""); return { documents: 40, nothing: 3, lines: [] }; },
    fileAdventures: async (src, o) => { calls.push(`adventures:${src}`); o.onSite("The Hideous Halls", 1, 1); return { sites: [{ title: "The Hideous Halls", locations: 33, missing: [] }], failed: [] }; },
    siteOf: (id) => ({ id, title: "The Hideous Halls", src: "CS1" }),
    isFiled: async () => true,
    buildScene: async (id) => { calls.push(`scene:${id}`); return { status: "built", placed: 33, left: 0, known: true }; },
    keyBooks: ["GMWR", "CS1", "CS2", "CS3", "CS4", "CS5"],
    keyLocations: async (src, o) => { calls.push(`keys:${src}`); o.onRegion("Gloaming", 1, 1); return { hexes: 40, created: 40, failed: [] }; },
    hexMap: async (id) => { calls.push(`hex:${id}`); return { status: "ready", sceneId: `scene-${id}`, legend: true, pinned: 12 }; },
    ...over,
  };
};
const hooks = () => { const seen = []; return { seen, onProgress: (pct, phase) => seen.push([pct, phase]), cancelled: () => false }; };

test("stages run library, then adventures, then maps, and the numbers add up", async () => {
  const d = deps(), h = hooks();
  const r = await runWizardImport(stateWith(CS1(), MAP1()), h, d);
  assert.deepEqual(d.calls, ["library", "adventures:CS1", "keys:CS1", "scene:cs1-mugdulblub"]);
  assert.equal(r.imported, 40 + 33 + 40 + 1);
  assert.equal(r.already, 3);
  assert.deepEqual(r.needsYou, []);
  const pcts = h.seen.map((x) => x[0]);
  assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b), "progress never goes backwards");
  assert.equal(pcts.at(-1), 100);
});

test("a book with no adventures files none, and a map-only run still builds the scene", async () => {
  const d = deps({ adventureBooks: [] });
  const r = await runWizardImport(stateWith(CS1(), MAP1()), hooks(), d);
  assert.deepEqual(d.calls, ["library", "keys:CS1", "scene:cs1-mugdulblub"]);
  assert.equal(r.imported, 40 + 40 + 1);
});

test("a map whose adventure was never filed asks for the book instead of failing", async () => {
  const d = deps({ isFiled: async () => false });
  const r = await runWizardImport(stateWith(MAP1()), hooks(), d);
  assert.ok(!d.calls.includes("scene:cs1-mugdulblub"));
  assert.equal(r.needsYou.length, 1);
  assert.match(r.needsYou[0].why, /mapNoBook/);
});

test("pins the module cannot place, or only part of them, are the GM's to finish", async () => {
  const none = await runWizardImport(stateWith(CS1(), MAP1()), hooks(), deps({ buildScene: async () => ({ status: "built", placed: 0, left: 33, known: false }) }));
  assert.match(none.needsYou[0].why, /pinsByHand/);
  const some = await runWizardImport(stateWith(CS1(), MAP1()), hooks(), deps({ buildScene: async () => ({ status: "built", placed: 30, left: 3, known: true }) }));
  assert.match(some.needsYou[0].why, /pinsLeft.*"n":3/);
  const again = await runWizardImport(stateWith(CS1(), MAP1()), hooks(), deps({ buildScene: async () => ({ status: "already", placed: 0, left: 0, known: true }) }));
  assert.equal(again.already, 3 + 1);
  assert.deepEqual(again.needsYou, []);
});

test("failures from the library, an adventure and a scene all come back as things to look at", async () => {
  const d = deps({
    library: async () => ({ documents: 0, nothing: 0, lines: [{ status: "failed", name: "Goblin", note: "page unreadable" }, { status: "blocked", name: "Mounts", note: "no book", src: "WR" }, { status: "created", name: "x", note: "" }] }),
    fileAdventures: async () => ({ sites: [{ title: "Halls", locations: 30, missing: ["31", "32"] }], failed: [{ title: "Tower", error: "boom" }] }),
    buildScene: async () => ({ status: "failed" }),
  });
  const r = await runWizardImport(stateWith(CS1(), MAP1()), hooks(), d);
  assert.deepEqual(r.needsYou.map((x) => x.title), ["Goblin", "Halls", "Tower", "The Hideous Halls"]);   // a skipped entry is not among them
  assert.equal(r.imported, 30 + 40);   // the adventure's 30 pages and the key locations' 40
});

test("Stop ends the run after the stage in flight and says so", async () => {
  let stopped = false;
  const d = deps({ library: async () => { stopped = true; return { documents: 5, nothing: 0, lines: [] }; } });
  const r = await runWizardImport(stateWith(CS1(), MAP1()), { onProgress() {}, cancelled: () => stopped }, d);
  assert.equal(r.stopped, true);
  assert.deepEqual(d.calls, []);   // the stub library records nothing; no adventure or scene began
  assert.equal(r.imported, 5);
});


test("entries whose books were not added are counted and named by book, never listed as problems", async () => {
  const blocked = (src, n) => Array.from({ length: n }, (_, i) => ({ status: "blocked", name: `${src} row ${i}`, note: "no linked PDF", src }));
  const d = deps({ library: async () => ({ documents: 10, nothing: 0, lines: [...blocked("WR", 50), ...blocked("GMWR", 90), ...blocked("CS4", 3), ...blocked("", 2)] }) });
  const r = await runWizardImport(stateWith(CS1()), hooks(), d);
  assert.deepEqual(r.needsYou, []);
  assert.equal(r.skipped.n, 145);
  assert.deepEqual(r.skipped.books, ["Player's Guide to the Western Reaches", "Game Master's Guide to the Western Reaches", "Cursed Scroll 4: River of Night"]);
});

test("adventure pages that were already filed count as already had, not imported", async () => {
  const d = deps({ fileAdventures: async () => ({ sites: [{ title: "The Hideous Halls", locations: 33, created: 0, updated: 34, missing: [] }], failed: [] }) });
  const r = await runWizardImport(stateWith(CS1(), MAP1()), hooks(), d);
  assert.equal(r.imported, 40 + 40 + 1);  // the library's 40, the key locations' 40 and the scene; no adventure page is new
  assert.equal(r.already, 3 + 34);        // the library's 3 and the 34 pages read again
});
