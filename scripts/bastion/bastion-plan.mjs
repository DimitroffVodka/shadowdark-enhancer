/**
 * Shadowdark Enhancer — Bastions: the plan (pure).
 *
 * Draws a bastion as SVG markup from its type and upgrades, in two views:
 *
 *   exterior  the main building in the middle with each upgrade's own building
 *             set round it, a moat ring under the lot.
 *   interior  one connected compound seen from above, rooms on a grid:
 *               house    a hall and rooms off a corridor
 *               outpost  a palisade yard, rooms along the north range and the gate
 *               keep     ground floor, second floor and roof side by side
 *               castle   rooms lining the inside of the curtain wall, round a court
 *             With `roofs` each room shows its exterior over its tile instead.
 *
 * Every upgrade has the SLOT it took when it was built (state.upgrades[].slot)
 * and keeps it, so taking one down moves nothing. Slot numbers index the slot
 * list below for the type, in both views; the moat has slot -1 and no place.
 *
 * The art is the symbols in assets/bastion/sprites.svg (b- exterior, s- its cast
 * shadow, r- room tile), loaded once into the page. This module only writes
 * markup that `<use>`s them, so it runs and tests without a browser.
 */

import { esc } from "../shared/esc.mjs";

const SPRITE = 150, STEP = 150, MAXSLOTS = 20;
/** Exterior size of the main building, in plan units. */
const MAIN_SIZE = { house: 300, outpost: 400, keep: 400, castle: 540 };
const MOAT = "moat";
const GREEN = "#85A478";

/** A seeded scatter so the grass is the same every draw. */
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ---------------------------------------------------------------- exterior

/** Places round the main building for upgrades, nearest first, and never under it or its moat. */
export function exteriorSlots(typeId) {
  const half = (MAIN_SIZE[typeId] ?? 300) * 1.2 / 2 + 50, out = [];
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      const x = i * STEP, y = j * STEP;
      if (Math.abs(x) < half && Math.abs(y) < half) continue;
      out.push({ x, y, d: Math.hypot(x * 1.15, y) + (Math.atan2(y, x) + 4) * 0.01 });
    }
  }
  return out.sort((a, b) => a.d - b.d).slice(0, MAXSLOTS);
}

function exteriorView(typeId, count) {
  const size = MAIN_SIZE[typeId] ?? 300;
  const slots = exteriorSlots(typeId).slice(0, Math.max(count, 3));
  const margin = size * 1.2 / 2 + 90;
  return {
    hx: Math.max(margin, ...slots.map((p) => Math.abs(p.x) + SPRITE / 2 + 30)),
    hy: Math.max(margin, ...slots.map((p) => Math.abs(p.y) + SPRITE / 2 + 30)),
  };
}

function drawExterior({ type, slots: capacity, upgrades, built, name, label }) {
  const { hx, hy } = exteriorView(type, capacity), spots = exteriorSlots(type), size = MAIN_SIZE[type] ?? 300;
  const out = [`<rect x="${-hx}" y="${-hy}" width="${hx * 2}" height="${hy * 2}" fill="${GREEN}"/>`];
  const r = rng(7);
  for (let i = 0; i < 70; i += 1) {
    const x = -hx + r() * hx * 2, y = -hy + r() * hy * 2, s = 10 + r() * 8;
    out.push(`<use href="#tuft" x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${s.toFixed(0)}" height="${(s * 0.7).toFixed(0)}" opacity=".7"/>`);
  }
  out.push(`<path d="M0 ${size * 0.42} C 6 ${hy * 0.6}, -8 ${hy * 0.8}, 0 ${hy}" fill="none" stroke="#C5BEAC" stroke-width="46" stroke-linecap="round" opacity=".95"/>`);
  if (upgrades.some((u) => u.id === MOAT)) {
    const k = size * 1.2;
    out.push(`<use href="#b-moat" x="${-k / 2}" y="${-k / 2}" width="${k}" height="${k}"${fade(upgrades.find((u) => u.id === MOAT))}/>`);
  }
  const main = `x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}"`;
  out.push(`<use href="#s-${type}" ${main}/>`);
  const placed = upgrades.filter((u) => u.id !== MOAT && spots[u.slot]).map((u) => ({ ...u, p: spots[u.slot] })).sort((a, b) => a.p.y - b.p.y);
  const at = (q) => `x="${q.p.x - SPRITE / 2}" y="${q.p.y - SPRITE / 2}" width="${SPRITE}" height="${SPRITE}"`;
  for (const q of placed) out.push(`<use href="#s-${q.id}" ${at(q)}${fade(q)}/>`);
  out.push(`<use href="#b-${type}" ${main}${built ? "" : ' opacity=".45"'}/>`);
  for (const q of placed) out.push(`<g data-id="${q.id}"${fade(q)}><title>${esc(label(q.id))}</title><use href="#b-${q.id}" ${at(q)}/></g>`);
  const ny = -hy + 34;
  out.push(`<rect x="-150" y="${ny - 26}" width="300" height="40" rx="6" fill="#f4eee3" stroke="#806f5d" stroke-width="2" opacity=".92"/>`,
    `<text x="0" y="${ny + 2}" text-anchor="middle" font-size="24" font-family="Georgia,serif" fill="#2a221b">${esc(name)}</text>`);
  return { markup: out.join(""), viewBox: `${-hx} ${-hy} ${hx * 2} ${hy * 2}` };
}

/** An upgrade still being built is drawn faint. */
function fade(u) { return (u?.weeksLeft ?? 0) > 0 ? ' opacity=".45"' : ""; }

// ---------------------------------------------------------------- interior

/** Tiles are 512 units; they overlap by their 28 unit wall, so the pitch is 484. */
const P = 484, C = 96;

/** A double-loaded wing: rooms above and below a corridor with its entrance at the left end. */
function wing(cols, top, bottom) {
  const W = (cols - 1) * P + 512, H = 1024 + C, tiles = [];
  top.forEach((tile, i) => tiles.push({ x: i * P, y: 0, rot: 0, ...tile }));
  bottom.forEach((tile, i) => tiles.push({ x: i * P, y: 512 + C, rot: 180, ...tile }));
  return { W, H, tiles, corridor: [0, 512, W, C], entrance: { side: "left", a: 512 + 10, b: 512 + C - 10 } };
}
const slotRun = (from, n) => Array.from({ length: n }, (_, i) => ({ slot: from + i }));

function castleFloor() {
  const W = 6 * P + 512, H = 5 * P + 512, order = [];
  for (const c of [0, 1, 2, 4, 5, 6]) order.push({ x: c * P, y: 0, rot: 0 });                 // north range
  for (let r = 1; r <= 4; r += 1) { order.push({ x: 0, y: r * P, rot: 270 }); order.push({ x: 6 * P, y: r * P, rot: 90 }); }   // west and east
  for (const c of [0, 1, 2, 4, 5, 6]) order.push({ x: c * P, y: 5 * P, rot: 180 });          // south range, beside the gate
  const tiles = order.map((tile, i) => ({ ...tile, slot: i }));
  tiles.push({ x: 3 * P, y: 0, rot: 0, fixed: "great-hall" }, { x: 3 * P, y: 5 * P, rot: 0, fixed: "gatehouse" });
  return { W, H, tiles, courtyard: true, open: true, entrance: { side: "bottom", a: 3 * P + 190, b: 3 * P + 322 } };
}

function outpostFloor() {
  const W = 2 * P + 512, H = 2 * P + 512;
  return {
    W, H, open: true, entrance: { side: "bottom", a: P + 190, b: P + 322 },
    tiles: [
      { x: 0, y: 0, rot: 0, slot: 0 }, { x: P, y: 0, rot: 0, slot: 1 }, { x: 2 * P, y: 0, rot: 0, slot: 2 },
      { x: P, y: P, rot: 0, fixed: "yard-fire" },
      { x: 0, y: 2 * P, rot: 180, slot: 3 }, { x: 2 * P, y: 2 * P, rot: 180, slot: 4 }, { x: P, y: 2 * P, rot: 0, fixed: "gate-palisade" },
    ],
  };
}

function keepFloors() {
  const ground = wing(4, slotRun(0, 4), [{ fixed: "entrance-hall" }, { fixed: "stairwell" }, { slot: 4 }, { slot: 5 }]);
  const upper = wing(4, slotRun(6, 4), [{ empty: true }, { fixed: "stairwell" }, { empty: true }, { empty: true }]);
  upper.entrance = null;
  ground.name = "SDE.bastion.plan.groundFloor";
  upper.name = "SDE.bastion.plan.secondFloor";
  const roof = { W: ground.W, H: ground.H, tiles: [{ x: (ground.W - 512) / 2, y: (ground.H - 512) / 2, rot: 0, fixed: "roof-deck" }], roof: true, name: "SDE.bastion.plan.roof" };
  return [ground, upper, roof];
}

const HOUSE = () => wing(2, [{ fixed: "hall" }, { slot: 0 }], [{ slot: 1 }, { slot: 2 }]);
const PLANS = {
  house: { style: "timber", floors: () => [HOUSE()] },
  outpost: { style: "palisade", floors: () => [outpostFloor()] },
  keep: { style: "stone", floors: keepFloors },
  castle: { style: "castle", floors: () => [castleFloor()] },
};

/** How many upgrade rooms the type's plan has. */
export function interiorSlotCount(typeId) {
  const plan = PLANS[typeId];
  return plan ? Math.max(0, ...plan.floors().flatMap((f) => f.tiles.map((q) => q.slot ?? -1))) + 1 : 0;
}

const GROUND = { timber: ["#A98670", "plankHatch"], stone: ["#8E8B83", "flagHatch"], palisade: ["#B8AB8E", "leanHatch"], castle: ["#A9A38F", "stoneHatch"] };
const WALL_T = { timber: 26, stone: 34, palisade: 16, castle: 40 };
const WALL_C = { timber: ["#745846", "logHatch"], stone: ["#6F6D68", "stoneHatch"], castle: ["#7E7B73", "stoneHatch"] };

const wallBand = (x, y, w, h, style) => {
  const [fill, hatch] = WALL_C[style];
  const d = `M${x} ${y} h${w} v${h} h${-w} Z`;
  return `<path d="${d}" fill="${fill}" stroke="#010206" stroke-width="2.4"/><path d="${d}" fill="url(#${hatch})"/>`;
};

/** A bare room with a door gap on its bottom edge, for a tile nothing was built in. */
function emptyRoom(style) {
  const floor = style === "timber" ? ["#BD9D86", "plankHatch"] : ["#A8A59B", "flagHatch"];
  const wall = style === "timber" ? ["#745846", "logHatch"] : ["#6F6D68", "stoneHatch"];
  const d = "M0 0 H512 V512 H296 V484 H484 V28 H28 V484 H216 V512 H0 Z";
  return `<path d="M0 0 H512 V512 H0 Z" fill="${floor[0]}"/><path d="M0 0 H512 V512 H0 Z" fill="url(#${floor[1]})"/>`
    + `<path d="${d}" fill="${wall[0]}" fill-rule="evenodd" stroke="#010206" stroke-width="2.6"/><path d="${d}" fill="url(#${wall[1]})" fill-rule="evenodd"/>`;
}

/** A plain roof plane over a tile, for a fixed room with no exterior of its own. */
function roofPlane(a, b) {
  return `<path d="M20 20 H492 V256 H20 Z" fill="${a}"/><path d="M20 256 H492 V492 H20 Z" fill="${b}"/>`
    + `<path d="M20 20 H492 V492 H20 Z" fill="url(#shingleHatch)"/><path d="M20 20 H492 V492 H20 Z" fill="none" stroke="#010206" stroke-width="3.5"/>`
    + `<path d="M20 256 C150 252 360 260 492 256" fill="none" stroke="#010206" stroke-width="4"/>`;
}

/** Roofs on: the room's exterior over its tile. Open-air tiles have none. */
function roofOf(q, id, style) {
  const [ground, hatch] = GROUND[style === "palisade" ? "stone" : style];
  const sprite = (sid, k = 1) => `<g transform="translate(${256 - 256 * k} ${256 - 256 * k}) scale(${k})"><use href="#s-${sid}" width="512" height="512"/><use href="#b-${sid}" width="512" height="512"/></g>`;
  const patch = `<rect x="6" y="6" width="500" height="500" rx="26" fill="${ground}" stroke="#010206" stroke-width="2"/><rect x="6" y="6" width="500" height="500" rx="26" fill="url(#${hatch})"/>`;
  let inner;
  if (!q.fixed) inner = patch + sprite(id, 0.94);
  else if (q.fixed === "hall") inner = patch + sprite("house", 0.9);
  else if (q.fixed === "great-hall") inner = patch + sprite("keep", 0.9);
  else if (q.fixed === "stairwell") {
    inner = roofPlane("#8E8B83", "#7E7B73")
      + `<circle cx="256" cy="256" r="120" fill="#A8A59B" stroke="#010206" stroke-width="3.5"/><circle cx="256" cy="256" r="120" fill="none" stroke="#6F6D68" stroke-width="22" stroke-dasharray="26 16"/><circle cx="256" cy="256" r="74" fill="#7E7B73" stroke="#010206" stroke-width="3"/>`;
  } else if (q.fixed === "entrance-hall") inner = roofPlane("#C4A68F", "#B58F78");
  else if (q.fixed === "gatehouse") {
    inner = roofPlane("#8E8B83", "#7E7B73")
      + `<path d="M190 20 H322 V492 H190 Z" fill="#26211f" stroke="#010206" stroke-width="3"/><path d="M200 20 V492 M222 20 V492 M244 20 V492 M266 20 V492 M288 20 V492 M310 20 V492" stroke="#6F6D68" stroke-width="3"/>`;
  } else return "";
  return `<g class="roof" transform="translate(${q.x} ${q.y})">${inner}</g>`;
}

function drawInterior({ type, slots: capacity, upgrades, built, name, label, roofs, t }) {
  const plan = PLANS[type] ?? PLANS.house, style = plan.style, wt = WALL_T[style];
  const floors = plan.floors(), nslots = interiorSlotCount(type);
  const bySlot = new Map(upgrades.filter((u) => u.id !== MOAT && u.slot >= 0).map((u) => [u.slot, u]));
  const free = new Set();
  for (let i = 0; i < nslots && free.size < capacity - upgrades.length; i += 1) if (!bySlot.has(i)) free.add(i);
  const moat = upgrades.some((u) => u.id === MOAT), pad = moat ? 330 : 150, gap = 480, r = rng(11);
  const first = floors[0];
  let totalW = 0, totalH = 0;
  const out = [], captions = [];
  floors.forEach((fl, fi) => {
    const { W, H } = fl, ox = (fi % 2) * (first.W + gap), oy = Math.floor(fi / 2) * (first.H + gap + 60), ent = fl.entrance;
    totalW = Math.max(totalW, ox + W); totalH = Math.max(totalH, oy + H);
    const o = [`<g transform="translate(${ox} ${oy})">`];
    const [gf, gh] = GROUND[fl.roof ? "stone" : style];
    if (moat && fi === 0) {
      const m = wt + 110, ring = `x="${-m}" y="${-m}" width="${W + 2 * m}" height="${H + 2 * m}" rx="60" fill="none"`;
      o.push(`<rect ${ring} stroke="#7d6c4f" stroke-width="150"/>`, `<rect ${ring} stroke="#5B99A6" stroke-width="130"/>`, `<rect ${ring} stroke="url(#waterHatch)" stroke-width="130"/>`);
      const bridge = ent.side === "bottom"
        ? `M${ent.a - 12} ${H + wt - 20} H${ent.b + 12} V${H + m + 80} H${ent.a - 12} Z`
        : `M${-m - 80} ${ent.a - 12} H${-wt + 20} V${ent.b + 12} H${-m - 80} Z`;
      o.push(`<path d="${bridge}" fill="#8F6F52" stroke="#010206" stroke-width="2.4"/><path d="${bridge}" fill="url(#plankHatch)"/>`);
    }
    o.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${gf}"/><rect x="0" y="0" width="${W}" height="${H}" fill="url(#${gh})"/>`);
    if (fl.corridor) {
      const [cx, cy, cw, ch] = fl.corridor, timber = style === "timber";
      o.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="${timber ? "#8F6F52" : "#7E7B73"}"/><rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="url(#${timber ? "plankHatch" : "flagHatch"})"/>`);
    }
    if (fl.open) for (let i = 0; i < (W * H) / 90000; i += 1) o.push(`<use href="#tuft" x="${(r() * W).toFixed(0)}" y="${(r() * H).toFixed(0)}" width="22" height="15" opacity=".5"/>`);
    if (fl.courtyard) o.push(courtyard(W, H));
    for (const q of fl.tiles) {
      const cx = q.x + 256, cy = q.y + 256, tf = `translate(${cx} ${cy}) rotate(${q.rot}) translate(-256 -256)`;
      const up = bySlot.get(q.slot), id = up?.id, rf = roofs ? roofOf(q, id, style) : "";
      if (q.fixed) o.push(`<g transform="${tf}"><use href="#r-${q.fixed}" width="512" height="512"/></g>${rf}`);
      else if (id) o.push(`<g data-id="${id}"${fade(up)}><title>${esc(label(id))}</title><g transform="${tf}"><use href="#r-${id}" width="512" height="512"/></g>${rf}</g>`);
      else if (!free.has(q.slot)) o.push(`<g transform="${tf}">${emptyRoom(style)}</g>`);
      else {
        o.push(`<g transform="${tf}">${emptyRoom(style)}</g><g opacity=".85" data-free="1"><title>${esc(t("SDE.bastion.plan.free"))}</title><rect x="${q.x + 44}" y="${q.y + 44}" width="424" height="424" rx="14" fill="#ffffff22" stroke="#2a221b" stroke-width="3" stroke-dasharray="14 10"/>`
          + `<path d="M${cx - 30} ${cy} H${cx + 30} M${cx} ${cy - 30} V${cy + 30}" stroke="#2a221b" stroke-width="6" stroke-linecap="round"/></g>`);
      }
    }
    o.push(...shell({ fl, style, wt, W, H, ent }));
    o.push("</g>");
    out.push(o.join(""));
    if (fl.name) captions.push(`<text x="${ox + W / 2}" y="${oy + H + (moat && fi === 0 ? 260 : 120)}" text-anchor="middle" font-size="64" font-family="Georgia,serif" fill="#2a221b" stroke="#f4eee3" stroke-width="10" paint-order="stroke">${esc(t(fl.name))}</text>`);
  });
  const top = -pad, vw = totalW + 2 * pad, vh = totalH + 2 * pad;
  const ground = `<rect x="${-pad - 50}" y="${top - 50}" width="${vw + 100}" height="${vh + 100}" fill="${GREEN}"/>`;
  const title = `<text x="${totalW / 2}" y="${top + 60}" text-anchor="middle" font-size="84" font-family="Georgia,serif" fill="#2a221b" stroke="#f4eee3" stroke-width="14" paint-order="stroke">${esc(name)}</text>`;
  return { markup: ground + out.join("") + captions.join("") + title, viewBox: `${-pad} ${top} ${vw} ${vh}`, built };
}

/** The curtain wall's courtyard: a road from the gate to the great hall, a well, trees and a cart. */
function courtyard(W, H) {
  const rx = 3 * P + 190, o = [];
  o.push(`<path d="M${rx} ${H - 40} V${P} H${rx + 132} V${H - 40} Z" fill="#B8AB8E" stroke="#010206" stroke-width="3"/><path d="M${rx} ${H - 40} V${P} H${rx + 132} V${H - 40} Z" fill="url(#flagHatch)"/>`);
  const wx = W / 2, wy = H / 2 + 60;
  o.push(`<circle cx="${wx}" cy="${wy}" r="150" fill="#8E8B83" stroke="#010206" stroke-width="3"/><circle cx="${wx}" cy="${wy}" r="150" fill="url(#stoneHatch)"/><circle cx="${wx}" cy="${wy}" r="104" fill="#5B99A6" stroke="#010206" stroke-width="3"/><circle cx="${wx}" cy="${wy}" r="104" fill="url(#waterHatch)"/>`,
    `<path d="M${wx - 110} ${wy - 90} V${wy - 170} H${wx + 110} V${wy - 90}" fill="none" stroke="#5F4434" stroke-width="10"/>`);
  for (const [tx, ty] of [[P * 1.1, P * 1.1], [W - P * 1.1, P * 1.1], [P * 1.1, H - P * 1.3], [W - P * 1.1, H - P * 1.3], [P * 1.5, H / 2], [W - P * 1.5, H / 2]]) {
    o.push(`<circle cx="${tx + 14}" cy="${ty + 22}" r="86" fill="#9699AE" opacity=".4"/><circle cx="${tx}" cy="${ty}" r="84" fill="#4F6B65" stroke="#010206" stroke-width="3"/><circle cx="${tx - 18}" cy="${ty - 16}" r="48" fill="#5B7F6B" stroke="#010206" stroke-width="2"/><circle cx="${tx + 26}" cy="${ty + 20}" r="34" fill="#4F6B65" stroke="#010206" stroke-width="2"/>`);
  }
  const wheel = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="16" fill="#5F4434" stroke="#010206" stroke-width="3"/>`;
  o.push(`<g transform="translate(${P * 1.6} ${H - P * 1.5})"><path d="M0 0 H150 V84 H0 Z" fill="#876A56" stroke="#010206" stroke-width="3"/><path d="M12 12 H138 V72 H12 Z" fill="#D4B76A" stroke="#010206" stroke-width="2"/>${wheel(26, -6)}${wheel(26, 90)}${wheel(124, -6)}${wheel(124, 90)}</g>`);
  return o.join("");
}

/** The outer wall: a palisade, a curtain wall with drum towers, or the end caps of a wing (and a keep's turrets). */
function shell({ fl, style, wt, W, H, ent }) {
  const o = [];
  if (style === "palisade") {
    const pts = [];
    for (let x = -wt; x <= W + wt; x += 30) { pts.push([x, -wt / 2]); if (!ent || x < ent.a - 10 || x > ent.b + 10) pts.push([x, H + wt / 2]); }
    for (let y = 0; y <= H; y += 30) pts.push([-wt / 2, y], [W + wt / 2, y]);
    o.push(`<g fill="#A58562" stroke="#010206" stroke-width="2">${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15"/>`).join("")}</g>`);
  } else if (style === "castle") {
    o.push(wallBand(-wt, -wt, W + 2 * wt, wt, style), wallBand(-wt, 0, wt, H, style), wallBand(W, 0, wt, H, style),
      wallBand(-wt, H, ent.a + wt, wt, style), wallBand(ent.b, H, W - ent.b + wt, wt, style));
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      o.push(`<circle cx="${cx}" cy="${cy}" r="92" fill="#8E8B83" stroke="#010206" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="92" fill="url(#stoneHatch)"/><circle cx="${cx}" cy="${cy}" r="92" fill="none" stroke="#A8A59B" stroke-width="16" stroke-dasharray="18 12"/><circle cx="${cx}" cy="${cy}" r="64" fill="#7E7B73" stroke="#010206" stroke-width="2"/>`);
    }
  } else {
    if (fl.corridor) {
      const [, cy, , ch] = fl.corridor;
      o.push(wallBand(W, cy, wt, ch, style));
      if (ent) o.push(wallBand(-wt, cy, wt, ent.a - cy, style), wallBand(-wt, ent.b, wt, cy + ch - ent.b, style));
      else o.push(wallBand(-wt, cy, wt, ch, style));
    }
    if (style === "stone") {
      for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        o.push(`<path d="M${cx - 52} ${cy - 52} h104 v104 h-104 Z" fill="#8E8B83" stroke="#010206" stroke-width="3"/><path d="M${cx - 52} ${cy - 52} h104 v104 h-104 Z" fill="url(#stoneHatch)"/>`);
      }
    }
    if (fl.roof) {
      o.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#6F6D68" stroke-width="56"/><rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#A8A59B" stroke-width="30" stroke-dasharray="40 24"/><rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#010206" stroke-width="3"/>`);
    }
  }
  return o;
}

// ---------------------------------------------------------------- the plan

/**
 * The plan as markup for an <svg>, with its viewBox.
 *
 * @param {object} o
 * @param {string} o.type          house | outpost | keep | castle
 * @param {number} o.slots         how many upgrades the type holds
 * @param {Array<{id:string,slot:number,weeksLeft?:number}>} o.upgrades
 * @param {boolean} o.built        the bastion itself stands
 * @param {string} o.name
 * @param {"ext"|"in"} o.view
 * @param {boolean} [o.roofs]      interior only: each room shows its exterior
 * @param {(id:string)=>string} o.label  "Name: effect" for a tooltip
 * @param {(key:string)=>string} o.t     localizer for the plan's own words
 * @returns {{markup:string, viewBox:string}}
 */
export function renderPlan(o) {
  const args = { ...o, upgrades: o.upgrades ?? [], built: o.built !== false, name: o.name ?? "" };
  return o.view === "in" ? drawInterior(args) : drawExterior(args);
}
