#!/usr/bin/env node
/**
 * Capture the GM's reviewed adventure scenes into the module's data, or check that the data rebuilds them.
 *
 *   node tools/adventure-review/capture.mjs <world data copy> [--foundry <Foundry install>] [--verify]
 *
 * <world data copy> is a COPY of a world's `data` folder (it needs `scenes` and `actors`), never the live one: LevelDB is
 * opened read-write. The LevelDB reader is Foundry's own (classic-level, from the install's node_modules); --foundry
 * defaults to $FOUNDRY_DIR.
 *
 * Without --verify it writes scripts/importer/adventure/adventure-reviewed.mjs (walls patch, creatures, lights, links) and
 * regenerates ADVENTURE_TRAPS (adventure-traps.mjs) and the pins of ADVENTURE_LAYOUTS (adventure-layouts.mjs) in place.
 * With --verify it rebuilds every site from the shipped data, through the importer's own planners, at the captured scene's
 * size, compares it with the scene and exits 1 on any difference.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { wallEdges, wallsFor, planWalls, wallTypes, planLights } from "../../scripts/importer/adventure/adventure-walls.mjs";
import { ADVENTURE_TRAPS, planSiteTraps, regionShapes } from "../../scripts/importer/adventure/adventure-traps.mjs";
import { layoutFromPins, layoutSnippet, layoutFor, layoutPoints } from "../../scripts/importer/adventure/adventure-layouts.mjs";
import { regionRef } from "./region-uuid.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ADV = join(ROOT, "scripts/importer/adventure");
const MOD = "shadowdark-enhancer";
const TRAP = `${MOD}.trap`;
const TELEPORT = "teleportToken";
/** Positions in the new data: a tenth of a pixel on a 10,000 px map. */
const PLACES = 5;
const f = (n) => Number(n.toFixed(PLACES));
/** Copies of a site's scene that are not flagged with it but are the same picture: their link ends belong to that site. */
const SCENE_ALIASES = { yoq1XlM3AZjdctpY: "cs2-iron-fortress" };   // the Iron Fortress "(Levels)" copy
/** What Foundry gives an AmbientLight's config when it is not set, so a light ships only what differs. */
const LIGHT_DEFAULTS = {
  negative: false, priority: 0, alpha: 0.5, angle: 360, color: null, coloration: 1, attenuation: 0.5, luminosity: 0.5,
  saturation: 0, contrast: 0, shadows: 0, animation: { type: null, speed: 5, intensity: 5, reverse: false },
  darkness: { min: 0, max: 1 }, bright: 0, dim: 0,
};
const WALL_KEYS = ["door", "ds", "move", "sight", "light", "sound"];
const TRAP_KEYS = ["trap", "checkAbility", "checkDc", "damage", "when", "holds"];
const TRAP_EXTRAS = { applyDamage: true, chance: "", resets: false };   // shipped only when not this

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const VERIFY = args.includes("--verify");
const FOUNDRY = opt("--foundry") ?? process.env.FOUNDRY_DIR;
const DATA = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--foundry");
if (!DATA || !FOUNDRY) {
  console.error("usage: node tools/adventure-review/capture.mjs <world data copy> [--foundry <Foundry install>] [--verify]");
  process.exit(2);
}
const { ClassicLevel } = await import(pathToFileURL(join(FOUNDRY, "node_modules/classic-level/index.js")).href);
const warnings = [];
const warn = (m) => warnings.push(m);

// ─── Reading the world ─────────────────────────────────────────────────────────

/** Every document of one LevelDB, embedded ones put back under their parent as `_<collection>` (a token's delta as `delta`). */
async function readDocs(dir) {
  const db = new ClassicLevel(dir, { valueEncoding: "json" });
  const rows = [];
  for await (const row of db.iterator()) rows.push(row);
  await db.close();
  const depth = (k) => k.split("!")[1].split(".").length;
  rows.sort((a, b) => depth(a[0]) - depth(b[0]) || (a[0] < b[0] ? -1 : 1));
  const top = [], byPath = new Map();
  for (const [key, doc] of rows) {
    const [, coll, ids] = key.split("!");
    const field = coll.split(".").at(-1), path = ids.split(".");
    byPath.set(ids, doc);
    if (path.length === 1) { top.push(doc); continue; }
    const parent = byPath.get(path.slice(0, -1).join("."));
    if (!parent) continue;
    if (field === "delta") parent.delta = doc;
    else (parent[`_${field}`] ??= []).push(doc);
  }
  return top;
}

const scenes = await readDocs(join(DATA, "scenes"));
const actors = new Map((await readDocs(join(DATA, "actors"))).map((a) => [a._id, a]));
const siteOf = (s) => s.flags?.[MOD]?.adventureMap?.site ?? null;
const sites = new Map();
for (const s of scenes) {
  const id = siteOf(s);
  if (!id) continue;
  if (sites.has(id)) throw new Error(`two scenes are flagged as ${id}`);
  if (s.padding) throw new Error(`${id}: the scene has padding; the data assumes the picture fills it`);
  sites.set(id, s);
}
const ids = [...sites.keys()].sort();
const rectOf = (s) => ({ x: 0, y: 0, width: s.width, height: s.height });
const frac = (rect, x, y) => [f((x - rect.x) / rect.width), f((y - rect.y) / rect.height)];

/** A Region's shapes as the data keeps them: `box`, `shape` or `shapes` (fractions), or null when one cannot be kept. */
function areaOf(region, rect, label) {
  const shapes = region.shapes ?? [];
  if (shapes.some((s) => s.hole || (s.type === "rectangle" && s.rotation))) { warn(`${label}: a hole or a turned rectangle, not captured`); return null; }
  if (shapes.length === 1 && shapes[0].type === "rectangle") {
    const s = shapes[0];
    return { box: [...frac(rect, s.x, s.y), f(s.width / rect.width), f(s.height / rect.height)] };
  }
  if (!shapes.length || shapes.some((s) => s.type !== "polygon")) { warn(`${label}: shapes ${shapes.map((s) => s.type)} not captured`); return null; }
  const polys = shapes.map((s) => { const out = []; for (let i = 0; i < s.points.length; i += 2) out.push(frac(rect, s.points[i], s.points[i + 1])); return out; });
  return polys.length === 1 ? { shape: polys[0] } : { shapes: polys };
}

/** Pair each of `a` with at most one of `b` by `dist` (<= tol), nearest pairs first. */
function pairUp(a, b, dist, tol) {
  const cand = [];
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) { const d = dist(a[i], b[j]); if (d <= tol) cand.push([d, i, j]); }
  cand.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const ab = new Map(), used = new Set();
  for (const [, i, j] of cand) if (!ab.has(i) && !used.has(j)) { ab.set(i, j); used.add(j); }
  return ab;
}
const segDist = (p, q) => Math.min(
  Math.max(...p.map((v, k) => Math.abs(v - q[k]))),
  Math.max(Math.abs(p[0] - q[2]), Math.abs(p[1] - q[3]), Math.abs(p[2] - q[0]), Math.abs(p[3] - q[1])),
);
const ptDist = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));

// ─── Capture ───────────────────────────────────────────────────────────────────

function captureWalls(id, s) {
  const rect = rectOf(s), data = wallsFor(id), types = wallTypes({});
  const at = ([u, v]) => [Math.round(rect.x + u * rect.width), Math.round(rect.y + v * rect.height)];
  const edges = wallEdges(data).map(([a, b, door], i) => ({ i, c: [...at(a), ...at(b)], base: door ? types.door : types.wall }))
    .filter((e) => e.c[0] !== e.c[2] || e.c[1] !== e.c[3]);   // too short to build at this size
  const walls = s._walls ?? [];
  for (const w of walls) {
    if (w.dir || w.doorSound || w.animation || Object.values(w.threshold ?? {}).some((v) => v !== null && v !== false)) warn(`${id}: wall ${w._id} has a direction, threshold, door sound or animation, not captured`);
  }
  const match = pairUp(edges, walls, (e, w) => segDist(e.c, w.c), 2);
  const drop = [], set = {};
  edges.forEach((e, k) => {
    if (!match.has(k)) { drop.push(e.i); return; }
    const w = walls[match.get(k)], diff = {};
    for (const key of WALL_KEYS) if (w[key] !== e.base[key]) diff[key] = w[key];
    if (Object.keys(diff).length) set[e.i] = diff;
  });
  const used = new Set(match.values());
  const add = walls.filter((w, j) => !used.has(j))
    .map((w) => [...frac(rect, w.c[0], w.c[1]), ...frac(rect, w.c[2], w.c[3]), ...WALL_KEYS.map((k) => w[k])])
    .sort((p, q) => p.join() < q.join() ? -1 : 1);
  if (!data && walls.length) warn(`${id}: the scene has walls but the module has no wall data for it, so placeSiteWalls builds none`);
  return drop.length || Object.keys(set).length || add.length ? { drop, set, add } : null;
}

function captureLights(id, s) {
  const rect = rectOf(s), planned = planLights(wallsFor(id), rect), lights = s._lights ?? [];
  const match = pairUp(planned, lights, ptDist, 2);
  const drop = planned.map((p, i) => i).filter((i) => !match.has(i));
  const used = new Set(match.values());
  const add = lights.filter((l, j) => !used.has(j)).map((l) => {
    const config = {};
    for (const [k, v] of Object.entries(l.config ?? {})) if (JSON.stringify(v) !== JSON.stringify(LIGHT_DEFAULTS[k])) config[k] = v;
    const label = l.flags?.[MOD]?.adventureLight;
    return { at: frac(rect, l.x, l.y), config, ...(typeof label === "string" ? { label } : {}), ...(l.elevation ? { elevation: l.elevation } : {}) };
  }).sort((p, q) => p.at.join() < q.at.join() ? -1 : 1);
  return drop.length || add.length ? { drop, add } : null;
}

function captureCreatures(id, s) {
  const rect = rectOf(s);
  return (s._tokens ?? []).flatMap((tk) => {
    const actor = actors.get(tk.actorId);
    if (actor?.type !== "NPC") return [];
    const own = [tk.delta?.name, tk.name].find((n) => n && n !== actor.name);
    return [[actor.name, ...frac(rect, tk.x, tk.y), ...(own ? [own] : [])]];
  }).sort((p, q) => p[0].localeCompare(q[0]) || p[2] - q[2] || p[1] - q[1]);
}

function captureTraps(id, s) {
  const rect = rectOf(s);
  // A trap the book's line still describes keeps that line, so its effect is read from the GM's book.
  const byBook = new Map((ADVENTURE_TRAPS[id] ?? []).filter((e) => Number.isInteger(e.nth)).map((e) => [e.pin, e]));
  let hand = 0;
  const out = [];
  for (const r of [...(s._regions ?? [])].sort((p, q) => p.name.localeCompare(q.name) || (p._id < q._id ? -1 : 1))) {
    const b = (r._behaviors ?? []).find((x) => x.type === TRAP);
    if (!b) continue;
    const flag = r.flags?.[MOD]?.adventureTrap;
    const num = /^(\d+)\./.exec(r.name)?.[1];
    const pin = flag?.pin ?? (num ? Number(num) : null);
    const area = areaOf(r, rect, `${id} trap "${r.name}"`);
    if (!area) continue;
    const trap = Object.fromEntries(TRAP_KEYS.map((k) => [k, b.system[k]]));
    for (const [k, v] of Object.entries(TRAP_EXTRAS)) if ((b.system[k] ?? v) !== v) trap[k] = b.system[k];
    const book = byBook.get(pin);
    if (book) byBook.delete(pin);
    const nth = book ? book.nth : (flag?.nth ?? `hand${++hand}`);
    out.push({ pin, nth, ...(book?.dc !== undefined ? { dc: book.dc } : {}), ...area, trap });
  }
  return out.sort((p, q) => (p.pin ?? Infinity) - (q.pin ?? Infinity) || String(p.nth).localeCompare(String(q.nth), "en", { numeric: true }));
}

/** A teleport behavior's destinations, each as the absolute "Scene.<id>.Region.<id>" (null for one that names no region). */
const destinationsOf = (s, r, b) => [...(b.system?.destinations ?? [])].map((d) => {
  const ref = regionRef(d, [s._id, r._id, b._id]);
  return ref ? `Scene.${ref.sceneId}.Region.${ref.regionId}` : null;
});

/**
 * Every teleport between two adventure maps, once per pair. A teleport on an adventure map that ends up in no pair (its
 * destination unreadable, gone, or on a map that is not an adventure's) stops the capture: dropping it silently would take
 * the link out of the shipped data.
 */
function captureLinks() {
  const where = new Map();   // region uuid -> {site, scene, region}
  for (const s of scenes) {
    const site = siteOf(s) ?? SCENE_ALIASES[s._id];
    if (site) for (const r of s._regions ?? []) where.set(`Scene.${s._id}.Region.${r._id}`, { site, s, r });
  }
  const seen = new Set(), paired = new Set(), out = [];
  const keyOf = ({ site, r }) => `${site}\u0000${r.name}\u0000${r._id}`;
  for (const [uuid, from] of [...where].sort((p, q) => keyOf(p[1]) < keyOf(q[1]) ? -1 : 1)) {
    for (const b of from.r._behaviors ?? []) {
      if (b.type !== TELEPORT) continue;
      for (const dest of destinationsOf(from.s, from.r, b)) {
        const to = where.get(dest);
        const pair = [uuid, dest].sort().join("|");
        if (!to || seen.has(pair)) continue;
        seen.add(pair);
        paired.add(uuid).add(dest);
        const [a, z] = [from, to].sort((p, q) => keyOf(p) < keyOf(q) ? -1 : 1);
        const end = (e) => ({ name: e.r.name, site: e.site, ...areaOf(e.r, rectOf(e.s), `link "${e.r.name}"`) });
        const name = a.r.flags?.[MOD]?.adventureLink?.link ?? z.r.flags?.[MOD]?.adventureLink?.link ?? a.r.name;
        out.push({ name, a: end(a), b: end(z) });
      }
    }
  }
  const lost = [...where].filter(([uuid, { r }]) => !paired.has(uuid) && (r._behaviors ?? []).some((b) => b.type === TELEPORT));
  if (lost.length) {
    const say = ([, { s, r }]) => `${siteOf(s) ?? s.name}: "${r.name}" -> ${JSON.stringify((r._behaviors ?? []).filter((b) => b.type === TELEPORT).flatMap((b) => [...(b.system?.destinations ?? [])]))}`;
    throw new Error(`teleports that join no other adventure map's region, not captured:\n${lost.map(say).join("\n")}`);
  }
  const names = out.map((l) => l.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) throw new Error(`two links share a name: ${twice.join(", ")}`);
  return out.sort((p, q) => p.a.site.localeCompare(q.a.site) || p.name.localeCompare(q.name));
}

const pinsOf = (s) => (s._notes ?? []).filter((n) => Number.isInteger(n.flags?.[MOD]?.adventurePin?.num)).map((n) => ({ num: n.flags[MOD].adventurePin.num, x: n.x, y: n.y }));

// ─── Writing the data ──────────────────────────────────────────────────────────

/** A value as JavaScript source: unquoted keys where they can be, a space after each comma. */
const js = (v) => {
  if (Array.isArray(v)) return `[${v.map(js).join(", ")}]`;
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    return e.length ? `{ ${e.map(([k, x]) => `${/^(?:[A-Za-z_$][\w$]*|\d+)$/.test(k) ? k : JSON.stringify(k)}: ${js(x)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
};
/** Items `per` to a line at an indent, each followed by a comma. */
const lines = (items, indent, per = 1) => {
  const out = [];
  for (let i = 0; i < items.length; i += per) out.push(`${indent}${items.slice(i, i + per).join(", ")},`);
  return out.join("\n");
};
const block = (name, entries) => `export const ${name} = {\n${entries.join("\n")}\n};\n`;

async function write() {
  const walls = [], creatures = [], lights = [];
  const counts = {};
  for (const id of ids) {
    const s = sites.get(id);
    const w = captureWalls(id, s), l = captureLights(id, s), c = captureCreatures(id, s);
    counts[id] = { walls: w ? `-${w.drop.length} ~${Object.keys(w.set).length} +${w.add.length}` : "as built", creatures: c.length, lights: l ? `-${l.drop.length} +${l.add.length}` : "as built" };
    if (w) {
      walls.push(`  ${JSON.stringify(id)}: {`);
      walls.push(w.drop.length ? `    drop: [\n${lines(w.drop, "      ", 20)}\n    ],` : "    drop: [],");
      walls.push(`    set: ${js(w.set)},`);
      walls.push(w.add.length ? `    add: [\n${lines(w.add.map(js), "      ")}\n    ],` : "    add: [],");
      walls.push("  },");
    }
    creatures.push(c.length ? `  ${JSON.stringify(id)}: [\n${lines(c.map(js), "    ", 2)}\n  ],` : `  ${JSON.stringify(id)}: [],`);
    if (l) {
      lights.push(`  ${JSON.stringify(id)}: {`);
      lights.push(`    drop: [${l.drop.join(", ")}],`);
      lights.push(l.add.length ? `    add: [\n${lines(l.add.map(js), "      ")}\n    ],` : "    add: [],");
      lights.push("  },");
    }
  }
  const links = captureLinks();
  const header = `/**
 * Shadowdark Enhancer — the adventure maps as the GM reviewed them, on top of what the importer makes from the module's own
 * data: walls and doors corrected, creatures placed and named, lights moved or added, stairs and ladders joined.
 *
 * GENERATED by tools/adventure-review/capture.mjs from the reviewed scenes of a world: do not edit by hand, capture again
 * (the tool's README says how). Positions only, as fractions of the whole map picture (0 to 1), so they fit the GM's copy of
 * a map at any resolution; no book text and no art.
 *
 *   REVIEWED_WALLS      per site, a patch on the walls planWalls makes from ADVENTURE_WALLS (adventure-walls.mjs):
 *                       drop  the edges (wallEdges index) the reviewed scene no longer has
 *                       set   edge index -> the door type, door state or senses that changed
 *                       add   [x1, y1, x2, y2, door, ds, move, sight, light, sound] for each wall the scene has besides
 *   REVIEWED_CREATURES  per site, every creature on the reviewed map: [monster, x, y, name], x and y its top-left corner, the
 *                       monster the bestiary name it is made from, the name only when the GM gave it one. It replaces the
 *                       book's markers and the creatures read from the book's text; an empty list places none
 *   REVIEWED_LIGHTS     per site: drop, the data's lights (by index) the scene no longer has where they were; add, the lights
 *                       it has besides, each with its config as it differs from Foundry's defaults
 *   REVIEWED_LINKS      the stairs, ladders, shafts and trapdoors: a pair of teleport ends {name, site, box|shape}, each
 *                       sending a token to the other (adventure-links.mjs)
 */

`;
  const text = header
    + block("REVIEWED_WALLS", walls) + "\n"
    + block("REVIEWED_CREATURES", creatures) + "\n"
    + block("REVIEWED_LIGHTS", lights) + "\n"
    + `export const REVIEWED_LINKS = [\n${lines(links.map(js), "  ")}\n];\n`;
  await writeFile(join(ADV, "adventure-reviewed.mjs"), text);

  // ADVENTURE_TRAPS, in place: the file's header and helpers stay as they are.
  const trapEntries = [];
  for (const id of ids) {
    const traps = captureTraps(id, sites.get(id));
    counts[id].traps = traps.length;
    if (traps.length) trapEntries.push(`  // ${sites.get(id).name}\n  ${JSON.stringify(id)}: [\n${lines(traps.map(js), "    ")}\n  ],`);
  }
  const trapsPath = join(ADV, "adventure-traps.mjs");
  const traps = await readFile(trapsPath, "utf8");
  const start = traps.indexOf("export const ADVENTURE_TRAPS = {\n"), end = traps.indexOf("\n};\n", start) + 4;
  await writeFile(trapsPath, traps.slice(0, start) + block("ADVENTURE_TRAPS", trapEntries) + traps.slice(end));

  // The pins of ADVENTURE_LAYOUTS, in place, one site at a time.
  const layoutsPath = join(ADV, "adventure-layouts.mjs");
  let layouts = await readFile(layoutsPath, "utf8");
  for (const id of ids) {
    const pins = pinsOf(sites.get(id));
    counts[id].pins = pins.length;
    if (!pins.length) continue;
    const head = `  ${JSON.stringify(id)}: {\n`, at = layouts.indexOf(head);
    if (at < 0) throw new Error(`${id}: no layout to replace in adventure-layouts.mjs`);
    const stop = layouts.indexOf("\n  },\n", at) + 6;
    layouts = layouts.slice(0, at) + layoutSnippet(id, layoutFromPins(pins, rectOf(sites.get(id)))) + "\n" + layouts.slice(stop);
  }
  await writeFile(layoutsPath, layouts);
  console.table(counts);
  console.log(`${links.length} links`);
}

// ─── Verify ────────────────────────────────────────────────────────────────────

async function verify() {
  const { REVIEWED_WALLS, REVIEWED_CREATURES, REVIEWED_LIGHTS, REVIEWED_LINKS } = await import("../../scripts/importer/adventure/adventure-reviewed.mjs");
  const { planReviewedCreatures } = await import("../../scripts/importer/adventure/adventure-scene.mjs");
  const { planLinkEnds } = await import("../../scripts/importer/adventure/adventure-links.mjs");
  const rows = {}, problems = [];
  const bad = (id, what) => problems.push(`${id}: ${what}`);
  const shapeDist = (p, q) => {
    if (p.length !== q.length) return Infinity;
    let d = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i].type !== q[i].type) return Infinity;
      const a = p[i].type === "rectangle" ? [p[i].x, p[i].y, p[i].width, p[i].height] : p[i].points;
      const b = q[i].type === "rectangle" ? [q[i].x, q[i].y, q[i].width, q[i].height] : q[i].points;
      if (a.length !== b.length) return Infinity;
      for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k]));
    }
    return d;
  };
  // Every end of every link, where the world has it (the "(Levels)" copy counts as its site).
  const worldEnds = [];
  for (const s of scenes) {
    const site = siteOf(s) ?? SCENE_ALIASES[s._id];
    if (site) for (const r of s._regions ?? []) if ((r._behaviors ?? []).some((b) => b.type === TELEPORT)) worldEnds.push({ site, s, r });
  }
  for (const id of ids) {
    const s = sites.get(id), rect = rectOf(s), row = (rows[id] = {});

    // Walls: every built wall is on the scene and every scene wall is built, same door, state and senses.
    const built = planWalls(wallsFor(id), rect, wallTypes({}), REVIEWED_WALLS[id]), walls = s._walls ?? [];
    const wm = pairUp(built, walls, (b, w) => (WALL_KEYS.every((k) => b[k] === w[k]) ? segDist(b.c, w.c) : Infinity), 2);
    row.walls = `${wm.size}/${walls.length}`;
    if (wm.size !== built.length || wm.size !== walls.length) bad(id, `walls: ${built.length} built, ${walls.length} on the scene, ${wm.size} the same`);

    // Creatures: the same monsters with the same names, each within a pixel.
    const plan = planReviewedCreatures({ list: REVIEWED_CREATURES[id], rect });
    const toks = (s._tokens ?? []).flatMap((tk) => {
      const a = actors.get(tk.actorId);
      return a?.type === "NPC" ? [{ monster: a.name, x: tk.x, y: tk.y, name: [tk.delta?.name, tk.name].find((n) => n && n !== a.name) }] : [];
    });
    const cm = pairUp(plan, toks, (p, tk) => (p.monster === tk.monster && p.name === tk.name ? ptDist(p, tk) : Infinity), 1);
    row.creatures = `${cm.size}/${toks.length}`;
    if (cm.size !== plan.length || cm.size !== toks.length) bad(id, `creatures: ${plan.length} planned, ${toks.length} on the scene, ${cm.size} the same`);
    // Each token's own two names, where they differ, can only carry one of them.
    for (const tk of s._tokens ?? []) if (tk.delta?.name && tk.name !== tk.delta.name) warn(`${id}: token "${tk.name}" is named "${tk.delta.name}" on its sheet; both are built as "${tk.delta.name}"`);

    // Traps: same name, area within 2 px and mechanics.
    const { traps } = planSiteTraps({ entries: ADVENTURE_TRAPS[id] ?? [], texts: {}, pins: {}, rect, gridSize: s.grid?.size ?? 100, squaresOf: () => [] });
    const regions = (s._regions ?? []).filter((r) => (r._behaviors ?? []).some((b) => b.type === TRAP));
    const mech = (sys) => JSON.stringify([...TRAP_KEYS, ...Object.keys(TRAP_EXTRAS)].map((k) => sys[k] ?? TRAP_EXTRAS[k]));
    const tm = pairUp(traps, regions, (t, r) => {
      const sys = r._behaviors.find((b) => b.type === TRAP).system;
      return t.name === r.name && mech({ ...TRAP_EXTRAS, ...t.system }) === mech(sys) ? shapeDist(t.shapes, r.shapes) : Infinity;
    }, 2);
    row.traps = `${tm.size}/${regions.length}`;
    if (tm.size !== traps.length || tm.size !== regions.length) bad(id, `traps: ${traps.length} planned, ${regions.length} on the scene, ${tm.size} the same`);

    // Link ends on this map: same name and area.
    const ends = planLinkEnds({ links: REVIEWED_LINKS, siteId: id, rect });
    const mine = worldEnds.filter((e) => e.site === id);
    const lm = pairUp(ends, mine, (e, w) => (e.data.name === w.r.name ? shapeDist(e.data.shapes, w.r.shapes) : Infinity), 2);
    row.links = `${lm.size}/${mine.length}`;
    if (lm.size !== ends.length || lm.size !== mine.length) bad(id, `link ends: ${ends.length} planned, ${mine.length} in the world, ${lm.size} the same`);

    // Lights: where they are, and their radii and colour.
    const lights = planLights(wallsFor(id), rect, REVIEWED_LIGHTS[id]), have = s._lights ?? [];
    const lit = (c) => JSON.stringify([c.bright ?? 0, c.dim ?? 0, c.color ?? null]);
    const lim = pairUp(lights, have, (p, l) => (lit(p.config) === lit(l.config) ? ptDist(p, l) : Infinity), 2);
    row.lights = `${lim.size}/${have.length}`;
    if (lim.size !== lights.length || lim.size !== have.length) bad(id, `lights: ${lights.length} planned, ${have.length} on the scene, ${lim.size} the same`);
    const dark = wallsFor(id)?.dark ?? 0;
    if (dark !== (s.environment?.darknessLevel ?? 0)) bad(id, `darkness: data ${dark}, scene ${s.environment?.darknessLevel}`);

    // Pins: every pin within a pixel.
    const points = layoutPoints(layoutFor(id)), pins = pinsOf(s);
    const off = pins.filter((p) => { const q = points.get(p.num); return !q || ptDist(p, { x: q.x * rect.width, y: q.y * rect.height }) > 1; });
    row.pins = `${pins.length - off.length}/${pins.length}`;
    if (off.length || points.size !== pins.length) bad(id, `pins: ${points.size} in the layout, ${pins.length} on the scene, off: ${off.map((p) => p.num).join(", ")}`);
  }
  // Every pair joins the two ends the world joins.
  const uuidOf = (e) => `Scene.${e.s._id}.Region.${e.r._id}`;
  for (const link of REVIEWED_LINKS) {
    if (!sites.has(link.a.site) || !sites.has(link.b.site)) continue;   // a map this world has not built
    const find = (end) => worldEnds.find((e) => e.site === end.site && e.r.name === end.name && shapeDist(regionShapes(end, rectOf(e.s)), e.r.shapes) <= 2);
    const a = find(link.a), b = find(link.b);
    const joined = a && b && [[a, b], [b, a]].some(([x, y]) => x.r._behaviors.some((bh) => bh.type === TELEPORT && destinationsOf(x.s, x.r, bh).includes(uuidOf(y))));
    if (!joined) bad(link.a.site, `link "${link.name}" does not join the same two ends in the world`);
  }
  console.table(rows);
  if (problems.length) { console.log(problems.join("\n")); process.exitCode = 1; } else console.log("Every site rebuilds as the world has it.");
}

if (VERIFY) await verify(); else await write();
if (warnings.length) console.log(`\n${warnings.join("\n")}`);
