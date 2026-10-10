/**
 * The adventure maps as the GM reviewed them (adventure-reviewed.mjs, made by tools/adventure-review/capture.mjs): the pure
 * planners that apply the review on top of the module's own data, and checks on the captured data itself. The round trip
 * against the reviewed world is `capture.mjs --verify` (it needs a copy of that world, so it is not run here).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADVENTURE_WALLS, planWalls, planLights, wallEdges, wallTypes } from "../scripts/importer/adventure/adventure-walls.mjs";
import { ADVENTURE_LAYOUTS } from "../scripts/importer/adventure/adventure-layouts.mjs";
import { REVIEWED_WALLS, REVIEWED_CREATURES, REVIEWED_LIGHTS, REVIEWED_LINKS } from "../scripts/importer/adventure/adventure-reviewed.mjs";
import { planReviewedCreatures, markerTokenData, placeReviewedCreatures, MARKER_FLAG } from "../scripts/importer/adventure/adventure-scene.mjs";
import { planLinkEnds, isLinkEnd, linksOf, placeSiteLinks, LINK_FLAG } from "../scripts/importer/adventure/adventure-links.mjs";
import { onPreImportAdventure, ADVENTURE_PACK_FLAG } from "../scripts/importer/adventure/adventure-pack.mjs";
import { regionRef } from "../tools/adventure-review/region-uuid.mjs";

const TYPES = wallTypes({});
const RECT = { x: 0, y: 0, width: 1000, height: 500 };
const MOD = "shadowdark-enhancer";

// Invented data throughout, but for the checks on the shipped data at the end.

test("the walls patch drops, retypes and adds walls on top of the planned ones", () => {
  const data = { loops: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]], solids: [], doors: [[0.2, 0.5, 0.3, 0.5]] };
  const patch = { drop: [1], set: { 4: { door: 2, ds: 2 } }, add: [[0.6, 0.1, 0.6, 0.4, 0, 0, 20, 0, 0, 0]] };
  const w = planWalls(data, RECT, TYPES, patch);
  assert.deepEqual(w.map((x) => x.c), [[0, 0, 500, 0], [500, 250, 0, 250], [0, 250, 0, 0], [200, 250, 300, 250], [600, 50, 600, 200]]);
  assert.deepEqual([w[3].door, w[3].ds], [2, 2], "the door became a locked secret door");
  assert.deepEqual([w[4].door, w[4].move, w[4].sight], [0, 20, 0], "an added wall keeps its own senses");
  assert.deepEqual(planWalls(data, RECT, TYPES), planWalls(data, RECT, TYPES, null), "no patch, the walls as before");
});

test("the walls patch names an edge by its place in the data, so a tiny picture that loses a short edge still patches the right walls", () => {
  const data = { loops: [[[0, 0], [0.0001, 0], [0.5, 0], [0.5, 0.5]]], doors: [] };
  const patch = { drop: [2] };   // the edge (0.5, 0) to (0.5, 0.5)
  for (const rect of [{ x: 0, y: 0, width: 10000, height: 10000 }, { x: 0, y: 0, width: 100, height: 100 }]) {
    const w = planWalls(data, rect, TYPES, patch);
    assert.ok(!w.some((x) => x.c[0] === rect.width / 2 && x.c[2] === rect.width / 2), `no wall down the side at ${rect.width} px`);
  }
  assert.equal(wallEdges(data).length, 4);
});

test("the lights patch takes out a light that was moved and adds the scene's own, flagged for a re-run", () => {
  const data = { lights: [{ at: [0.1, 0.1], bright: 5, dim: 10, color: "#ff0000", label: "Fire" }, { at: [0.9, 0.9], bright: 5, dim: 10, color: "#ff0000" }] };
  const l = planLights(data, RECT, { drop: [0], add: [{ at: [0.2, 0.2], config: { dim: 20 }, label: "Fire", elevation: -1 }, { at: [0.5, 0.5], config: { bright: 1 } }] });
  assert.deepEqual(l.map((x) => [x.x, x.y]), [[900, 450], [200, 100], [500, 250]]);
  assert.deepEqual(l[1].config, { dim: 20 });
  assert.equal(l[1].elevation, -1);
  assert.equal(l[1].flags[MOD].adventureLight, "Fire");
  assert.equal(l[2].flags[MOD].adventureLight, true);
  assert.equal(l[2].elevation, undefined);
});

test("reviewed creatures stand where the GM left them, unsnapped, with the names the GM gave them, and a second run adds none", () => {
  const list = [["Goblin", 0.1, 0.2], ["Goblin", 0.1234, 0.2, "Grub"], ["Rat", 0.5, 0.5]];
  const plan = planReviewedCreatures({ list, rect: { x: 10, y: 0, width: 1000, height: 500 } });
  assert.deepEqual(plan, [
    { key: "review/1", monster: "Goblin", x: 110, y: 100 },
    { key: "review/2", monster: "Goblin", x: 133, y: 100, name: "Grub" },
    { key: "review/3", monster: "Rat", x: 510, y: 250 },
  ]);
  assert.deepEqual(planReviewedCreatures({ list, rect: RECT, placed: ["review/1", "review/3"] }).map((p) => p.key), ["review/2"]);
  assert.deepEqual(planReviewedCreatures({ list: [], rect: RECT }), [], "an empty list places nobody");
});

test("a named creature's token and its actor both carry the name; an unnamed one keeps the monster's", () => {
  const source = { _id: "x", name: "Goblin", texture: { src: "g.webp" }, delta: null };
  const named = markerTokenData(source, { key: "review/2", x: 1, y: 2, name: "Grub" }, "s1", "A1");
  assert.equal(named.name, "Grub");
  assert.deepEqual(named.delta, { name: "Grub" });
  assert.deepEqual(named.flags[MOD][MARKER_FLAG], { site: "s1", key: "review/2" });
  const plain = markerTokenData(source, { key: "review/1", x: 1, y: 2 }, "s1", "A1");
  assert.equal(plain.name, "Goblin");
  assert.equal(plain.delta, null);
});

test("a scene whose creatures were placed before the review list existed keeps them, and gets no second set", async () => {
  const token = (key) => ({ getFlag: (m, k) => (m === MOD && k === MARKER_FLAG ? { site: "cs3-sea-wolf", key } : undefined) });
  const scene = { tokens: { contents: [token("4/Bandit/1")] }, createEmbeddedDocuments: async () => assert.fail("nothing is created") };
  assert.deepEqual(await placeReviewedCreatures(scene, { id: "cs3-sea-wolf" }, RECT), { placed: 0, missing: [] });
});

const LINKS = [
  { name: "Stairs: 1 to 2", a: { name: "Stairs down", site: "s1", box: [0.1, 0.1, 0.1, 0.1] }, b: { name: "Stairs up", site: "s2", box: [0.5, 0.5, 0.1, 0.2] } },
  { name: "Ladder", a: { name: "Ladder up", site: "s1", box: [0, 0, 0.1, 0.1] }, b: { name: "Ladder down", site: "s1", shape: [[0, 0], [0.1, 0], [0.1, 0.1]], disabled: true } },
];

test("a site's build makes its own ends of each link, unwired, and the other map's end waits for that map", () => {
  const s1 = planLinkEnds({ links: LINKS, siteId: "s1", rect: RECT });
  assert.deepEqual(s1.map((p) => `${p.link.name}/${p.end}`), ["Stairs: 1 to 2/a", "Ladder/a", "Ladder/b"]);
  assert.deepEqual(s1[0].data.shapes, [{ type: "rectangle", x: 100, y: 50, width: 100, height: 50, rotation: 0, hole: false }]);
  assert.deepEqual(s1[0].data.behaviors, [{ type: "teleportToken", name: "Stairs: 1 to 2", disabled: false, system: { destinations: [], choice: true } }]);
  assert.equal(s1[2].data.behaviors[0].disabled, true, "an end the GM switched off is built switched off");
  assert.deepEqual(s1[0].data.flags[MOD][LINK_FLAG], { site: "s1", link: "Stairs: 1 to 2", end: "a" });
  assert.equal(s1[2].data.shapes[0].type, "polygon");
  const s2 = planLinkEnds({ links: LINKS, siteId: "s2", rect: RECT });
  assert.deepEqual(s2.map((p) => `${p.link.name}/${p.end}`), ["Stairs: 1 to 2/b"]);
  assert.deepEqual(linksOf(LINKS, "s2").map((l) => l.name), ["Stairs: 1 to 2"]);
});

test("an end already on the scene is not made again, whether the module flagged its end or the GM made it by hand", () => {
  const regions = [
    { name: "Stairs down", flag: { link: "Stairs: 1 to 2", end: "a" } },
    { name: "Ladder up", flag: { link: "Ladder" } },   // made by hand during the review: known by its name
  ];
  assert.deepEqual(planLinkEnds({ links: LINKS, siteId: "s1", rect: RECT, regions }).map((p) => `${p.link.name}/${p.end}`), ["Ladder/b"]);
  assert.equal(isLinkEnd({ link: "Ladder" }, "Ladder down", LINKS[1], "a"), false);
  assert.equal(isLinkEnd({ link: "Other" }, "Ladder up", LINKS[1], "a"), false);
});

/** A scene stub that keeps the Regions created on it, each with a teleport behavior that records its updates. */
function linkScene(site, sceneId = site) {
  const scene = { site, regions: [] };
  scene.createEmbeddedDocuments = async (type, docs) => docs.map((d) => {
    const flags = d.flags;
    const region = { name: d.name, uuid: `Scene.${sceneId}.Region.${scene.regions.length}`, getFlag: (m, k) => flags?.[m]?.[k] };
    region.behaviors = d.behaviors.map((b) => {
      const behavior = { type: b.type, system: { ...b.system } };
      behavior.update = async (u) => { behavior.system.destinations = u["system.destinations"]; };
      return behavior;
    });
    scene.regions.push(region);
    return region;
  });
  scene.getFlag = (m, k) => (k === "adventureMap" ? { site } : undefined);
  return scene;
}

/** A world of stub scenes: game.scenes finds in `scenes`, and fromUuidSync finds only a Region on one of them. */
function linkWorld(t, scenes) {
  const before = { game: globalThis.game, fromUuidSync: globalThis.fromUuidSync };
  globalThis.game = { scenes: { find: (fn) => scenes.find(fn) } };
  globalThis.fromUuidSync = (uuid) => scenes.flatMap((s) => s.regions).find((r) => r.uuid === uuid) ?? null;
  t.after(() => Object.assign(globalThis, before));
}

test("the second map to be built wires the pair both ways; a re-run adds nothing and re-aims nothing", async (t) => {
  const s1 = linkScene("cs5-leng-1"), s2 = linkScene("cs5-leng-2");
  const scenes = [s1];
  linkWorld(t, scenes);
  const pair = REVIEWED_LINKS.find((l) => l.a.site === "cs5-leng-1" && l.b.site === "cs5-leng-2");
  const first = await placeSiteLinks(s1, { id: "cs5-leng-1" }, RECT);
  assert.equal(first.wired, 0, "the other map is not built yet");
  scenes.push(s2);
  const second = await placeSiteLinks(s2, { id: "cs5-leng-2" }, RECT);
  assert.ok(second.wired >= 2);
  const a = s1.regions.find((r) => r.name === pair.a.name), b = s2.regions.find((r) => r.name === pair.b.name);
  assert.deepEqual(a.behaviors[0].system.destinations, [b.uuid]);
  assert.deepEqual(b.behaviors[0].system.destinations, [a.uuid]);
  assert.deepEqual(await placeSiteLinks(s2, { id: "cs5-leng-2" }, RECT), { placed: 0, wired: 0 });
});

test("kept in the compendium, each map packed and taken away before the next is built: importing them back joins every pair", async (t) => {
  const cross = REVIEWED_LINKS.filter((l) => l.a.site !== l.b.site);
  const sites = [...new Set(cross.flatMap((l) => [l.a.site, l.b.site]))];
  const world = [];
  linkWorld(t, world);
  const packed = [];
  for (const site of sites) {   // the wizard: build, pack, remove
    const scene = linkScene(site);
    world.push(scene);
    await placeSiteLinks(scene, { id: site }, RECT);
    world.splice(world.indexOf(scene), 1);
    packed.push(scene);
  }
  for (const scene of packed) {   // import each Adventure back, as Foundry's Adventure#import runs the hook's postImport
    const options = { preImport: [], postImport: [] };
    onPreImportAdventure({ getFlag: (m, k) => (k === ADVENTURE_PACK_FLAG ? { site: scene.site } : undefined) }, options);
    world.push(scene);
    for (const fn of options.postImport) await fn({ created: { Scene: [scene] } }, options);
  }
  const ends = cross.flatMap((l) => [[l, "a", "b"], [l, "b", "a"]]);
  const endOf = (l, e) => packed.find((s) => s.site === l[e].site).regions.find((r) => r.name === l[e].name);
  const wired = ends.filter(([l, from, to]) => endOf(l, from).behaviors[0].system.destinations?.[0] === endOf(l, to).uuid);
  assert.equal(wired.length, ends.length, `${wired.length} of ${ends.length} cross-map ends wired`);
});

test("an end whose destination was deleted with its map is aimed again at the rebuilt map; a live one is left", async (t) => {
  const s1 = linkScene("cs5-leng-1"), old = linkScene("cs5-leng-2");
  const scenes = [s1, old];
  linkWorld(t, scenes);
  await placeSiteLinks(s1, { id: "cs5-leng-1" }, RECT);
  await placeSiteLinks(old, { id: "cs5-leng-2" }, RECT);
  scenes.pop();   // the GM deletes level 2 and builds it again: its Regions have new ids
  const rebuilt = linkScene("cs5-leng-2", "rebuilt");
  scenes.push(rebuilt);
  const res = await placeSiteLinks(rebuilt, { id: "cs5-leng-2" }, RECT);
  const pair = REVIEWED_LINKS.find((l) => l.a.site === "cs5-leng-1" && l.b.site === "cs5-leng-2");
  const a = s1.regions.find((r) => r.name === pair.a.name), b = rebuilt.regions.find((r) => r.name === pair.b.name);
  assert.deepEqual(a.behaviors[0].system.destinations, [b.uuid], "the stale end follows the rebuilt map");
  assert.deepEqual(b.behaviors[0].system.destinations, [a.uuid]);
  assert.ok(res.wired >= 2);
  assert.equal(await placeSiteLinks(rebuilt, { id: "cs5-leng-2" }, RECT).then((r) => r.wired), 0, "live ends are not re-aimed");
});

// The shipped data.

test("the reviewed walls patch only edges the data has, and adds walls inside the map", () => {
  for (const [id, patch] of Object.entries(REVIEWED_WALLS)) {
    const n = wallEdges(ADVENTURE_WALLS[id]).length;
    assert.ok(ADVENTURE_WALLS[id], `${id}: a patch with no walls to patch`);
    for (const i of [...patch.drop, ...Object.keys(patch.set).map(Number)]) assert.ok(Number.isInteger(i) && i >= 0 && i < n, `${id}: edge ${i}`);
    for (const w of patch.add) assert.ok(w.length === 10 && w.slice(0, 4).every((u) => u >= 0 && u <= 1), `${id}: ${w}`);
  }
});

test("every reviewed site has its creature list, its pins, and links whose ends are on reviewed maps", () => {
  for (const [id, list] of Object.entries(REVIEWED_CREATURES)) {
    assert.ok(ADVENTURE_LAYOUTS[id], `${id}: no pins`);
    for (const [monster, u, v, name] of list) assert.ok(typeof monster === "string" && u >= 0 && u <= 1 && v >= 0 && v <= 1 && (name === undefined || typeof name === "string"), `${id}: ${monster}`);
  }
  assert.deepEqual(REVIEWED_CREATURES["cs6-city"], [], "the City of Masks keeps no creatures, so the book's text adds none");
  for (const id of Object.keys(REVIEWED_LIGHTS)) assert.ok(ADVENTURE_WALLS[id], `${id}: lights on a map with no walls data are never built`);
  const names = new Set();
  for (const link of REVIEWED_LINKS) {
    assert.ok(!names.has(link.name), `two links named ${link.name}`);
    names.add(link.name);
    for (const end of [link.a, link.b]) assert.ok(REVIEWED_CREATURES[end.site] && (end.box || end.shape), `${link.name}: ${end.name}`);
  }
});

test("a teleport's destination is read in every form Foundry stores: absolute, same scene and another scene", () => {
  const from = ["S1", "R1", "B1"];
  assert.deepEqual(regionRef("Scene.S2.Region.R9", from), { sceneId: "S2", regionId: "R9" });
  assert.deepEqual(regionRef("..R2", from), { sceneId: "S1", regionId: "R2" }, "a region beside the behavior's own");
  assert.deepEqual(regionRef("...S2.Region.R9", from), { sceneId: "S2", regionId: "R9" }, "a region on another scene");
  assert.deepEqual(regionRef("...Region.R3", from), { sceneId: "S1", regionId: "R3" }, "a typed path down from the scene");
  assert.equal(regionRef("..Region.R3", from), null, "a typed path down from the region names its child, no region of the scene");
  assert.deepEqual(regionRef(".", ["S1", "R1", "B1"]), null, "the behavior itself");
  assert.equal(regionRef(".B2", from), null, "a sibling behavior is no region");
  assert.equal(regionRef("....R1", from), null, "above the scene there is nothing");
  assert.equal(regionRef("Compendium.x.y.Region.R1", from), null);
  assert.equal(regionRef(undefined, from), null);
});
