#!/usr/bin/env node
/**
 * Checks a wall-data entry before it goes into adventure-walls.mjs (the same checks the leak test and the creature test make).
 *   node tools/wall-author/check-entry.mjs <site-id> <entry.txt> [creatures.json]
 * entry.txt is the block ink_rooms.py writes (or any `"site": { aspect, loops, solids, doors, lights }` text).
 * creatures.json (optional) is { "<site>": { creatures: { "<pin>": { "<name>": count } } } }, how many creatures each room must hold.
 * Env: OUTSIDE=19,20 pins that stand outside the walls on purpose; PINS='{"10":[0.75,0.27]}' trial pin positions.
 * Prints one line per problem and exits 1 if there is one; the summary lines are for the author to read.
 */
import { readFileSync } from "node:fs";
import { planWalls, wallTypes, reachableSquares, planLights } from "../../scripts/importer/adventure/adventure-walls.mjs";
import { ADVENTURE_LAYOUTS } from "../../scripts/importer/adventure/adventure-layouts.mjs";
import { ADVENTURE_SITES } from "../../scripts/importer/adventure/adventure-manifest.mjs";

const [site, file, creaturesFile] = process.argv.slice(2);
if (!site || !file) { console.error("usage: check-entry.mjs <site-id> <entry.txt> [creatures.json]"); process.exit(2); }
const text = readFileSync(file, "utf8");
const data = Object.values(new Function(`return ({ ${text.trim().replace(/,$/, "")} })`)())[0];
const layout = structuredClone(ADVENTURE_LAYOUTS[site]), found = Object.values(ADVENTURE_SITES).flat().find((s) => s.id === site);
for (const [n, p] of Object.entries(JSON.parse(process.env.PINS ?? "{}"))) layout.pins[n] = p;   // trial pin positions, [fraction x, fraction y]
if (!layout || !found) { console.error(`no layout or manifest site for ${site}`); process.exit(2); }
const OUTSIDE = (process.env.OUTSIDE ?? "").split(",").filter(Boolean);   // pins that are outside the walls on purpose
const W = 3600, H = Math.round(W / data.aspect), cols = found.grid[0], grid = W / cols, problems = [];
const bad = (m) => { problems.push(m); console.log("PROBLEM", m); };
if (Math.abs(data.aspect - layout.aspect) / layout.aspect > 0.005) bad(`aspect ${data.aspect} is not the layout's ${layout.aspect}`);
for (const r of [...data.loops, ...(data.solids ?? [])]) { if (r.length < 3) bad("a ring of fewer than 3 points"); for (const [x, y] of r) if (x < 0 || x > 1 || y < 0 || y > 1) bad("a point outside the map"); }

// sealed areas: the walls drawn on a coarse grid, flooded from the page's corner and from each pin
function sealed(doorsClosed, K = 4) {
  const w = Math.ceil(W / K) + 2, h = Math.ceil(H / K) + 2, wall = new Uint8Array(w * h);
  const line = (x1, y1, x2, y2) => { const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / K)); for (let i = 0; i <= n; i++) { const cx = Math.round((x1 + ((x2 - x1) * i) / n) / K), cy = Math.round((y1 + ((y2 - y1) * i) / n) / K); for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) wall[(cy + dy) * w + cx + dx] = 1; } };
  for (const s of planWalls({ ...data, doors: doorsClosed ? data.doors : [] }, { x: 0, y: 0, width: W, height: H }, wallTypes({}))) line(...s.c);
  const region = new Int32Array(w * h); let next = 0;
  const fill = (sx, sy) => { const id = ++next, st = [sy * w + sx]; region[st[0]] = id; while (st.length) { const p = st.pop(), x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (!wall[q] && !region[q]) { region[q] = id; st.push(q); } } } };
  fill(0, 0); const outside = region[0], areas = new Map(), out = [];
  for (const [num, [u, v]] of Object.entries(layout.pins)) {
    if (OUTSIDE.includes(num)) continue;
    let x = Math.round((u * W) / K), y = Math.round((v * H) / K);
    for (let r = 1; wall[y * w + x] && r < 8; r++) { const hit = [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]].find(([dx, dy]) => !wall[(y + dy) * w + x + dx]); if (hit) { x += hit[0]; y += hit[1]; } }
    if (!region[y * w + x]) fill(x, y);
    const r = region[y * w + x];
    if (r === outside) out.push(num); else areas.set(r, [...(areas.get(r) ?? []), num]);
  }
  return { out, areas: [...areas.values()] };
}
const closed = sealed(true), open = sealed(false);
for (const n of closed.out) bad(`pin ${n} is in the rock around the dungeon (set OUTSIDE=${n} if it is meant to be)`);
console.log(`areas with doors closed: ${closed.areas.length}: ${closed.areas.map((a) => a.join("+")).join(" | ")}`);
console.log(`areas with doors open:   ${open.areas.length}: ${open.areas.map((a) => a.join("+")).join(" | ")}`);
if (data.doors.length && open.areas.length >= closed.areas.length) bad("opening the doors joins nothing: the doors do no work");
if (!data.doors.length) console.log("note: no doors");

// the squares of each room, and whether the creatures filed under it fit and stay in it
const rect = { x: 0, y: 0, width: W, height: H }, px = (n) => ({ x: layout.pins[n][0] * W, y: layout.pins[n][1] * H });
const need = creaturesFile ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(creaturesFile, "utf8"))[site]?.creatures ?? {}).map(([n, o]) => [n, Object.values(o).reduce((a, b) => a + b, 0)])) : {};
const sq = {}, key = (p) => `${Math.floor(p.x / grid)},${Math.floor(p.y / grid)}`;
for (const n of Object.keys(layout.pins)) {
  if (OUTSIDE.includes(n)) continue;
  sq[n] = new Set(reachableSquares(data, rect, grid, px(n), 600).map((s) => s.join(",")));
  const c = need[n] ?? 0;
  if (!sq[n].size) bad(`pin ${n} has no floor to stand on`);
  else if (c && sq[n].size - 1 < c) bad(`room ${n} has ${sq[n].size} squares for ${c} creatures (a pin in a cell, or a wall through the room?)`);
}
const area = new Map(); closed.areas.forEach((a, i) => a.forEach((n) => area.set(n, i)));
for (const a of Object.keys(sq)) for (const b of Object.keys(sq)) if (a !== b && area.get(a) !== area.get(b) && area.has(a) && area.has(b) && sq[a].has(key(px(b)))) bad(`room ${a}'s squares reach pin ${b}, which a wall or closed door separates it from`);
console.log("squares per room:", Object.entries(sq).map(([n, s]) => `${n}:${s.size}${need[n] ? "/" + need[n] : ""}`).join(" "));
console.log(`walls ${planWalls(data, rect, wallTypes({})).length} (doors ${data.doors.length}), lights ${planLights(data, rect).length}`);
console.log(problems.length ? `${problems.length} problem(s)` : "OK");
process.exit(problems.length ? 1 : 0);
