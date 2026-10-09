import test from "node:test";
import assert from "node:assert/strict";
import { DISTANCE } from "../scripts/encounter/encounter-result.mjs";
import { BATTLE_STATUS, FLAGS } from "../scripts/encounter/battle-maps/constants.mjs";
import {
  FOE_DEPTH_SQUARES, FOE_GAP_SQUARES, FOE_MIN_CROSS_SQUARES, battleTokens, centralZone, dealPictures, distanceBand,
  foePlan, foeZone, layoutMixed, layoutTokens, newBattleRecord, numberedNames, rectOf, resolveVariant, tokensToRemove,
  variantName,
} from "../scripts/encounter/battle-maps/encounter-battle-core.mjs";

const MOD = "shadowdark-enhancer";
const G = 100;

// ── helpers ──────────────────────────────────────────────────────────────────

/** The squares a token of `size` at px `pos` covers, as "c,r". */
const squares = (pos, size = 1, grid = G) => {
  const out = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out.push(`${pos.x / grid + c},${pos.y / grid + r}`);
  return out;
};
const allSquares = (spots, size = 1, grid = G) => spots.flatMap((p) => squares(p, size, grid));
const noOverlap = (spots, size = 1, grid = G) => {
  const all = allSquares(spots, size, grid);
  return new Set(all).size === all.length;
};
const onGrid = (spots, grid = G) => spots.every((p) => p.x % grid === 0 && p.y % grid === 0);
/** Is the token's whole footprint inside the px rect [x0, y0, x1, y1]? */
const inside = (p, size, [x0, y0, x1, y1], grid = G) => p.x >= x0 && p.y >= y0 && p.x + size * grid <= x1 && p.y + size * grid <= y1;
const touches = (p, size, rect, grid = G) => p.x < rect.x + rect.width && p.x + size * grid > rect.x && p.y < rect.y + rect.height && p.y + size * grid > rect.y;

// ── layoutTokens ─────────────────────────────────────────────────────────────

test("layoutTokens: nothing to place gives nothing (zero PCs, a junk count)", () => {
  const zone = [1000, 1000, 2000, 2000];
  assert.deepEqual(layoutTokens({ zone, count: 0 }), []);
  assert.deepEqual(layoutTokens({ zone, count: -3 }), []);
  assert.deepEqual(layoutTokens({ zone, count: Number.NaN }), []);
  assert.deepEqual(layoutTokens({ zone, count: undefined }), []);
});

test("layoutTokens: one token sits in the middle of the zone", () => {
  assert.deepEqual(layoutTokens({ zone: [1000, 1000, 2100, 2100], count: 1 }), [{ x: 1500, y: 1500 }]);
});

test("layoutTokens: a party is a compact block in the middle, on the grid, inside the zone", () => {
  const zone = [1250, 900, 2750, 2100];
  const spots = layoutTokens({ zone, count: 4 });
  assert.equal(spots.length, 4);
  assert.ok(onGrid(spots));
  assert.ok(spots.every((p) => inside(p, 1, zone)));
  assert.ok(noOverlap(spots));
  // 2x2, and the block's middle is the zone's middle (cells 13..27 x 9..21, so 20,15)
  assert.deepEqual(spots, [{ x: 1900, y: 1400 }, { x: 2000, y: 1400 }, { x: 1900, y: 1500 }, { x: 2000, y: 1500 }]);
});

test("layoutTokens: packed rows, a short last row centred under the others", () => {
  const spots = layoutTokens({ zone: [0, 0, 1000, 1000], count: 5 });
  const rows = new Map();
  for (const p of spots) rows.set(p.y, [...(rows.get(p.y) ?? []), p.x]);
  const byY = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(byY.map(([, xs]) => xs.length), [2, 2, 1], "ranks of 2, 2 and 1");
  assert.deepEqual(byY.map(([y]) => y), [300, 400, 500], "stacked without gaps, in the middle of the ten rows");
  const mid = (xs) => (Math.min(...xs) + Math.max(...xs)) / 2;
  assert.ok(Math.abs(mid(byY[2][1]) - mid(byY[0][1])) <= G / 2, "the short row is centred under the full ones");
});

test("layoutTokens: the same call always gives the same answer", () => {
  const args = { zone: [1250, 900, 2750, 2100], count: 17, occupied: [{ x: 1900, y: 1400, width: 100, height: 100 }] };
  assert.deepEqual(layoutTokens(args), layoutTokens({ ...args }));
});

test("layoutTokens: many foes never overlap, never leave the zone while it has room, and none is dropped", () => {
  const zone = [3300, 900, 3700, 2100];   // 4 wide x 12 tall = 48 squares
  for (const count of [1, 2, 3, 7, 12, 25, 47, 48]) {
    const spots = layoutTokens({ zone, count });
    assert.equal(spots.length, count, `count ${count}`);
    assert.ok(noOverlap(spots), `no overlap at ${count}`);
    assert.ok(spots.every((p) => inside(p, 1, zone)), `inside the zone at ${count}`);
    assert.ok(onGrid(spots));
  }
});

test("layoutTokens: more tokens than the zone holds spill to the nearest free squares, none dropped", () => {
  const zone = [1000, 1000, 1300, 1300];   // 3x3 = 9 squares
  const spots = layoutTokens({ zone, count: 14 });
  assert.equal(spots.length, 14);
  assert.ok(noOverlap(spots));
  assert.equal(spots.filter((p) => inside(p, 1, zone)).length, 9, "the zone is filled first");
  // the five that spilled are all right next to the zone, not scattered across the map
  const spilled = spots.filter((p) => !inside(p, 1, zone));
  assert.ok(spilled.every((p) => p.x >= 800 && p.x <= 1400 && p.y >= 800 && p.y <= 1400), JSON.stringify(spilled));
});

test("layoutTokens: a zone smaller than one square still places everyone", () => {
  const spots = layoutTokens({ zone: [1010, 1010, 1060, 1060], count: 5 });
  assert.equal(spots.length, 5);
  assert.ok(noOverlap(spots));
  assert.ok(onGrid(spots));
  assert.ok(spots.every((p) => Math.abs(p.x - 1000) <= 300 && Math.abs(p.y - 1000) <= 300), "they cluster around the zone");
});

test("layoutTokens: a zero-area zone (a point) is handled like a tiny one", () => {
  const spots = layoutTokens({ zone: [500, 500, 500, 500], count: 4 });
  assert.equal(spots.length, 4);
  assert.ok(noOverlap(spots));
});

test("layoutTokens: size-2 tokens take 2x2 squares each and stay on the grid", () => {
  const zone = [2000, 1000, 2800, 1800];   // 8x8
  const spots = layoutTokens({ zone, count: 5, size: 2 });
  assert.equal(spots.length, 5);
  assert.ok(noOverlap(spots, 2), "footprints do not overlap");
  assert.ok(onGrid(spots));
  assert.ok(spots.every((p) => inside(p, 2, zone)));
});

test("layoutTokens: size-2 tokens in a zone that fits only some spill the rest whole", () => {
  const spots = layoutTokens({ zone: [0, 0, 400, 200], count: 4, size: 2 });   // room for 2 across, 1 deep
  assert.equal(spots.length, 4);
  assert.ok(noOverlap(spots, 2));
  assert.equal(spots.filter((p) => inside(p, 2, [0, 0, 400, 200])).length, 2);
});

test("layoutTokens: a token bigger than the zone is placed beside it, not lost", () => {
  const spots = layoutTokens({ zone: [1000, 1000, 1200, 1200], count: 1, size: 3 });
  assert.equal(spots.length, 1);
  assert.ok(onGrid(spots));
});

test("layoutTokens: a half-square token still holds a whole square", () => {
  const spots = layoutTokens({ zone: [0, 0, 1000, 1000], count: 6, size: 0.5 });
  assert.ok(noOverlap(spots, 1));
});

test("layoutTokens: never lands on an occupied rect, even one that only clips a square", () => {
  const zone = [1000, 1000, 1500, 1500];
  const occupied = [
    { x: 1200, y: 1200, width: 100, height: 100 },   // exactly a square
    { x: 1050, y: 1050, width: 100, height: 100 },   // straddles four squares
    { x: 1400, y: 1000, width: 40, height: 500 },    // a sliver clipping a column
  ];
  for (const count of [1, 5, 12]) {
    const spots = layoutTokens({ zone, count, occupied });
    assert.equal(spots.length, count);
    assert.ok(noOverlap(spots));
    for (const p of spots) for (const o of occupied) assert.ok(!touches(p, 1, o), `${JSON.stringify(p)} touches ${JSON.stringify(o)}`);
  }
});

test("layoutTokens: a second group keeps off the first (the foes around the PCs)", () => {
  const zone = [1000, 1000, 1500, 1500];
  const first = layoutTokens({ zone, count: 8 });
  const second = layoutTokens({ zone, count: 8, occupied: first.map((p) => rectOf(p)) });
  assert.ok(noOverlap([...first, ...second]));
});

test("layoutTokens: bounds keep a spill on the map even from a corner zone", () => {
  const bounds = [0, 0, 1000, 800];
  const spots = layoutTokens({ zone: [0, 0, 200, 200], count: 30, bounds });
  assert.equal(spots.length, 30);
  assert.ok(noOverlap(spots));
  assert.ok(spots.every((p) => inside(p, 1, bounds)), JSON.stringify(spots.filter((p) => !inside(p, 1, bounds))));
  // and with size 2
  const big = layoutTokens({ zone: [800, 600, 1000, 800], count: 6, size: 2, bounds });
  assert.ok(big.every((p) => inside(p, 2, bounds)));
  assert.ok(noOverlap(big, 2));
});

test("layoutTokens: with the whole map full, the rest stack rather than vanish", () => {
  const bounds = [0, 0, 300, 300];
  const everything = [{ x: 0, y: 0, width: 300, height: 300 }];
  const spots = layoutTokens({ zone: [0, 0, 300, 300], count: 3, occupied: everything, bounds });
  assert.equal(spots.length, 3);
  assert.ok(onGrid(spots));
});

test("layoutTokens: from puts the first rank on the named edge", () => {
  const zone = [1000, 1000, 2000, 2000];
  const x = (spots) => new Set(spots.map((p) => p.x));
  const y = (spots) => new Set(spots.map((p) => p.y));
  const left = layoutTokens({ zone, count: 4, from: "left" });
  assert.ok(x(left).has(1000), "left edge");
  const right = layoutTokens({ zone, count: 4, from: "right" });
  assert.ok(x(right).has(1900), "right edge: the last square before 2000");
  const top = layoutTokens({ zone, count: 4, from: "top" });
  assert.ok(y(top).has(1000), "top edge");
  const bottom = layoutTokens({ zone, count: 4, from: "bottom" });
  assert.ok(y(bottom).has(1900), "bottom edge");
  for (const spots of [left, right, top, bottom]) {
    assert.equal(spots.length, 4);
    assert.ok(noOverlap(spots));
    assert.ok(spots.every((p) => inside(p, 1, zone)));
  }
});

test("layoutTokens: from fills ranks away from the edge, and a deep pack keeps its front rank on it", () => {
  const zone = [1000, 1000, 1500, 2200];   // 5 wide, 12 tall
  const spots = layoutTokens({ zone, count: 30, from: "top" });
  assert.equal(spots.length, 30);
  assert.ok(noOverlap(spots));
  assert.equal(Math.min(...spots.map((p) => p.y)), 1000);
  const frontRank = spots.filter((p) => p.y === 1000);
  assert.ok(frontRank.length >= 4, "the first rank is full width, not a lone token");
});

test("layoutTokens: a blocked front rank pushes foes back to the next free squares in the zone", () => {
  const zone = [1000, 1000, 1400, 1400];
  const occupied = [{ x: 1000, y: 1000, width: 400, height: 100 }];   // the whole top row
  const spots = layoutTokens({ zone, count: 4, from: "top", occupied });
  assert.ok(spots.every((p) => p.y >= 1100));
  assert.ok(spots.every((p) => inside(p, 1, zone)));
});

test("layoutTokens: another grid size works the same way", () => {
  const spots = layoutTokens({ zone: [140, 140, 700, 560], count: 9, grid: 70 });
  assert.equal(spots.length, 9);
  assert.ok(onGrid(spots, 70));
  assert.ok(noOverlap(spots, 1, 70));
  assert.ok(spots.every((p) => inside(p, 1, [140, 140, 700, 560], 70)));
});

test("layoutTokens: a bad zone is a loud error, not NaN positions", () => {
  assert.throws(() => layoutTokens({ zone: null, count: 1 }), TypeError);
  assert.throws(() => layoutTokens({ zone: [0, 0, 100], count: 1 }), TypeError);
  assert.throws(() => layoutTokens({ zone: [0, 0, Number.NaN, 100], count: 1 }), TypeError);
  assert.throws(() => layoutTokens({ zone: [0, 0, 100, 100], count: 1, bounds: [1, 2] }), TypeError);
});

test("layoutTokens: whatever the zone, size, count and clutter, everyone gets a free, on-the-map square of their own", () => {
  // a small seeded generator, so a failure names the case that broke
  let seed = 20261008;
  const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); };
  const bounds = [0, 0, 3000, 2000];
  for (let i = 0; i < 400; i++) {
    const x0 = rand(2900), y0 = rand(1900);
    const zone = [x0, y0, Math.min(3000, x0 + rand(900)), Math.min(2000, y0 + rand(700))];
    const size = 1 + rand(3);
    const count = Math.min(rand(60), Math.floor(150 / (size * size)));   // at most a quarter of the 600 squares: past that, stacking is the documented fallback
    const from = [null, "top", "bottom", "left", "right"][rand(5)];
    const occupied = Array.from({ length: rand(8) }, () => ({ x: rand(2800), y: rand(1800), width: 100 + rand(400), height: 100 + rand(400) }));
    const label = JSON.stringify({ zone, size, count, from, occupied });
    const spots = layoutTokens({ zone, count, size, occupied, bounds, from });
    assert.equal(spots.length, count, label);
    assert.ok(onGrid(spots), label);
    assert.ok(noOverlap(spots, size), label);
    for (const p of spots) {
      assert.ok(inside(p, size, bounds), `on the map: ${label}`);
      for (const o of occupied) assert.ok(!touches(p, size, o), `clear of ${JSON.stringify(o)}: ${label}`);
    }
  }
});

test("layoutTokens: a very large crowd stays fast and complete", () => {
  const started = Date.now();
  const spots = layoutTokens({ zone: [1000, 1000, 1500, 1500], count: 300, bounds: [0, 0, 4000, 3000] });
  assert.equal(spots.length, 300);
  assert.ok(noOverlap(spots));
  assert.ok(Date.now() - started < 2000, "300 tokens should take well under a second");
});

// ── layoutMixed ──────────────────────────────────────────────────────────────

test("layoutMixed: one answer per token, in the order asked, big ones first and nobody overlapping", () => {
  const zone = [1000, 1000, 1600, 1600];
  const sizes = [1, 2, 1, 1, 2];
  const spots = layoutMixed({ zone, sizes, bounds: [0, 0, 4000, 3000] });
  assert.equal(spots.length, 5);
  const all = spots.flatMap((p, i) => squares(p, sizes[i]));
  assert.equal(new Set(all).size, all.length, "no footprint overlaps another");
  assert.ok(spots.every((p, i) => inside(p, sizes[i], zone)), "all fit inside a 6x6 zone");
});

test("layoutMixed: keeps off what is already there", () => {
  const occupied = [{ x: 1000, y: 1000, width: 300, height: 300 }];
  const spots = layoutMixed({ zone: [1000, 1000, 1600, 1600], sizes: [1, 1, 2], occupied });
  const sizes = [1, 1, 2];
  spots.forEach((p, i) => assert.ok(!touches(p, sizes[i], occupied[0])));
});

test("layoutMixed: no tokens, no spots; junk sizes count as one square", () => {
  assert.deepEqual(layoutMixed({ zone: [0, 0, 500, 500], sizes: [] }), []);
  const spots = layoutMixed({ zone: [0, 0, 500, 500], sizes: [undefined, null, "x", 0] });
  assert.equal(spots.length, 4);
  assert.ok(noOverlap(spots));
});

// ── foeZone / foePlan ────────────────────────────────────────────────────────

test("distanceBand reads the roll the way the encounter card does", () => {
  for (const roll of [1, 2, 3, 4, 5, 6]) {
    assert.equal(`SDE.encounter.distance.${distanceBand(roll)}`, DISTANCE[roll], `roll ${roll}`);
  }
  for (const odd of [undefined, null, 0, 7, "x", Number.NaN]) assert.equal(distanceBand(odd), "near");
});

test("foeZone: close, near and far are 2, 6 and 12 squares from the party zone's edge", () => {
  // a roomy map, the party well inside it, so nothing is clamped; the party zone's squares end at 3500
  const map = { width: 8000, height: 6000 };
  const partyZone = [2500, 2500, 3500, 3500];
  for (const [roll, squaresAway] of [[1, 2], [2, 6], [3, 6], [4, 6], [5, 12], [6, 12]]) {
    const plan = foePlan({ map, partyZone, distanceRoll: roll });
    assert.equal(plan.side, "right");
    assert.equal(plan.from, "left");
    assert.equal(plan.zone[0] - 3500, squaresAway * G, `roll ${roll}`);
  }
  assert.deepEqual(FOE_GAP_SQUARES, { close: 2, near: 6, far: 12 });
});

test("foeZone: arrives on the side with the most room", () => {
  const map = { width: 4000, height: 3000 };
  const plan = (partyZone) => foePlan({ map, partyZone, distanceRoll: 3 });
  assert.equal(plan([200, 900, 1400, 2100]).side, "right", "party near the left edge");
  assert.equal(plan([2600, 900, 3800, 2100]).side, "left", "party near the right edge");
  assert.equal(plan([1300, 100, 2700, 700]).side, "bottom", "party near the top");
  assert.equal(plan([1300, 2300, 2700, 2900]).side, "top", "party near the bottom");
  // and the strip really is on that side
  assert.ok(plan([200, 900, 1400, 2100]).zone[0] >= 1400);
  assert.ok(plan([2600, 900, 3800, 2100]).zone[2] <= 2600);
  assert.ok(plan([1300, 100, 2700, 700]).zone[1] >= 700);
  assert.ok(plan([1300, 2300, 2700, 2900]).zone[3] <= 2300);
});

test("foeZone: a tie goes right, then left, bottom, top", () => {
  const map = { width: 4000, height: 3000 };
  const side = (partyZone) => foePlan({ map, partyZone, distanceRoll: 3 }).side;
  assert.equal(side([1500, 1000, 2500, 2000]), "right", "1500 each way left and right");
  assert.equal(side([1000, 1000, 3000, 2000]), "right", "1000 all round");
  assert.equal(side([1000, 1000, 3500, 2000]), "left", "left, bottom and top tie ahead of right");
  assert.equal(side([400, 1000, 3600, 2000]), "bottom", "bottom and top tie ahead of the ends");
  assert.equal(side([400, 1000, 3600, 2200]), "top", "top has more room than bottom");
});

test("foeZone: clamped inside the map and never into the party zone, whatever the roll", () => {
  const maps = [
    { map: { width: 4000, height: 3000 }, partyZone: [1250, 900, 2750, 2100] },
    { map: { width: 1500, height: 1200 }, partyZone: [450, 360, 1050, 840] },
    { map: { width: 4400, height: 1600 }, partyZone: [1700, 740, 2700, 900] },
    { map: { width: 4000, height: 3000 }, partyZone: [3300, 2400, 3900, 2900] },
    { map: { width: 1000, height: 1000 }, partyZone: [100, 100, 900, 900] },
    { map: { width: 4000, height: 3000 }, partyZone: [1480, 1400, 2520, 1620] },
  ];
  for (const { map, partyZone } of maps) {
    // the squares the party can stand on: the zone shrunk to whole squares
    const [px0, py0, px1, py1] = [Math.ceil(partyZone[0] / G) * G, Math.ceil(partyZone[1] / G) * G, Math.floor(partyZone[2] / G) * G, Math.floor(partyZone[3] / G) * G];
    for (const distanceRoll of [1, 3, 6]) {
      for (const size of [1, 2, 3]) {
        const { zone } = foePlan({ map, partyZone, distanceRoll, size });
        const [x0, y0, x1, y1] = zone;
        assert.ok(x0 >= 0 && y0 >= 0 && x1 <= map.width && y1 <= map.height, `inside the map: ${JSON.stringify({ map, partyZone, distanceRoll, zone })}`);
        assert.ok(x1 > x0 && y1 > y0, `not empty: ${JSON.stringify(zone)}`);
        const overlap = x0 < px1 && x1 > px0 && y0 < py1 && y1 > py0;
        assert.ok(!overlap, `clear of the party's squares: ${JSON.stringify({ partyZone, zone })}`);
        assert.ok(zone.every((v) => v % G === 0), `on the grid: ${JSON.stringify(zone)}`);
      }
    }
  }
});

test("foeZone: far on a map that is too short for it comes in nearer rather than leaving the map", () => {
  const map = { width: 4000, height: 3000 };
  const partyZone = [1250, 900, 2750, 2100];   // party squares end at 2700, 1300 to the edge
  const plan = foePlan({ map, partyZone, distanceRoll: 6 });
  assert.equal(plan.zone[2], 4000, "up against the edge");
  assert.ok(plan.zone[0] - 2700 < 12 * G, "nearer than 12 squares");
  assert.equal(plan.zone[2] - plan.zone[0], FOE_DEPTH_SQUARES * G, "but still as deep as asked");
});

test("foeZone: as wide as the party's side at least, and centred on it", () => {
  const map = { width: 8000, height: 6000 };
  // a wide party zone: the strip matches it
  const wide = foePlan({ map, partyZone: [1000, 1000, 1000 + 2000, 1000 + 2000], distanceRoll: 3 });
  assert.equal(wide.zone[3] - wide.zone[1], 2000);
  // a thin one (a boat's deck): the strip is the minimum width, centred on the deck
  const deck = foePlan({ map, partyZone: [3000, 3000, 4000, 3200], distanceRoll: 3 });
  assert.equal(deck.zone[3] - deck.zone[1], FOE_MIN_CROSS_SQUARES * G);
  assert.equal((deck.zone[1] + deck.zone[3]) / 2, 3100);
});

test("foeZone: a water map puts the foes in the water beside the boat", () => {
  // river-rowboat: 4400x1600, deck 1700..2700 x 740..900; the river is the whole map
  const map = { width: 4400, height: 1600 };
  const plan = foePlan({ map, partyZone: [1700, 740, 2700, 900], distanceRoll: 3 });
  assert.equal(plan.side, "right");
  assert.ok(plan.zone[0] >= 2700 && plan.zone[2] <= 4400);
  assert.ok(plan.zone[1] >= 0 && plan.zone[3] <= 1600);
  // ocean-open-sea: galleon deck 900..3100 x 1300..1700 on 4000x3000, more room above and below than at the ends
  const sea = foePlan({ map: { width: 4000, height: 3000 }, partyZone: [900, 1300, 3100, 1700], distanceRoll: 3 });
  assert.equal(sea.side, "bottom");
  assert.equal(sea.zone[1] - 1700, 6 * G);
  assert.equal(sea.from, "top");
});

test("foeZone: a taller foe gets a deeper strip", () => {
  const map = { width: 8000, height: 6000 };
  const depth = (size) => { const z = foeZone({ map, partyZone: [2500, 2500, 3500, 3500], distanceRoll: 3, size }); return z[2] - z[0]; };
  assert.equal(depth(1), FOE_DEPTH_SQUARES * G);
  assert.equal(depth(2), FOE_DEPTH_SQUARES * G);
  assert.equal(depth(3), 6 * G);
  assert.equal(depth(5), 10 * G);
});

test("foeZone: a party zone that fills the map leaves the whole map, and no side", () => {
  const plan = foePlan({ map: { width: 1000, height: 800 }, partyZone: [0, 0, 1000, 800], distanceRoll: 3 });
  assert.deepEqual(plan, { zone: [0, 0, 1000, 800], from: null, side: null });
});

test("foeZone: a party zone smaller than a square still gets a strip", () => {
  const plan = foePlan({ map: { width: 4000, height: 3000 }, partyZone: [1950, 1450, 2040, 1540], distanceRoll: 1 });
  assert.equal(plan.side, "right");
  assert.ok(plan.zone[0] > 2000);
});

test("foeZone is the plan's zone, and a bad party zone is a loud error", () => {
  const args = { map: { width: 4000, height: 3000 }, partyZone: [1250, 900, 2750, 2100], distanceRoll: 2 };
  assert.deepEqual(foeZone(args), foePlan(args).zone);
  assert.throws(() => foeZone({ ...args, partyZone: undefined }), TypeError);
});

test("PCs against the edge facing the foes, foes against theirs: the gap is the one asked for", () => {
  const map = { width: 4000, height: 3000 };
  const partyZone = [1250, 900, 2750, 2100];
  for (const [roll, away] of [[1, 2], [3, 6]]) {
    const plan = foePlan({ map, partyZone, distanceRoll: roll });
    const pcs = layoutTokens({ zone: partyZone, count: 4, from: plan.side });
    const foes = layoutTokens({ zone: plan.zone, count: 8, from: plan.from, occupied: pcs.map((p) => rectOf(p)) });
    const frontPc = Math.max(...pcs.map((p) => p.x + G));
    const frontFoe = Math.min(...foes.map((p) => p.x));
    assert.equal(frontFoe - frontPc, away * G, `roll ${roll}: squares between the front ranks`);
  }
});

test("foeZone: a map that names its foes zone is believed: the foes go there, whatever the roll", () => {
  // scattered islands: the party on one island, the foes on another, chasm between (the map's own zones)
  const map = { width: 2200, height: 1600, foes: [1500, 400, 1900, 1200] };
  const partyZone = [500, 600, 800, 1000];
  const plans = [1, 2, 3, 4, 5, 6, undefined].map((distanceRoll) => foePlan({ map, partyZone, distanceRoll }));
  for (const plan of plans) assert.deepEqual(plan, { zone: [1500, 400, 1900, 1200], from: null, side: null });
  assert.deepEqual(foeZone({ map, partyZone, distanceRoll: 6 }), [1500, 400, 1900, 1200]);
  // without it the same map puts them where the roll says (and "far" is not the island)
  const plain = foePlan({ map: { width: 2200, height: 1600 }, partyZone, distanceRoll: 6 });
  assert.notDeepEqual(plain.zone, map.foes);
  assert.equal(plain.side, "right");
});

test("foeZone: a foes zone is a copy, so a caller cannot move the map's own", () => {
  const map = { width: 2200, height: 1600, foes: [1500, 400, 1900, 1200] };
  const { zone } = foePlan({ map, partyZone: [500, 600, 800, 1000], distanceRoll: 3 });
  zone[0] = 0;
  assert.deepEqual(map.foes, [1500, 400, 1900, 1200]);
});

test("foeZone: a foes zone that is not a zone is ignored, and the roll decides as it does without one", () => {
  const partyZone = [1250, 900, 2750, 2100];
  const base = { width: 4000, height: 3000 };
  const expected = foePlan({ map: base, partyZone, distanceRoll: 3 });
  for (const foes of [null, undefined, "x", [], [1, 2, 3], [1, 2, 3, Number.NaN], [100, 100, 100, 500], [500, 500, 100, 100], [0, 0, 100, 0]]) {
    assert.deepEqual(foePlan({ map: { ...base, foes }, partyZone, distanceRoll: 3 }), expected, JSON.stringify(foes));
  }
});

test("foeZone: foes packed into a named zone stay in it and keep off the party", () => {
  const map = { width: 2200, height: 1600, foes: [1500, 400, 1900, 1200] };
  const partyZone = [500, 600, 800, 1000];
  const { zone, from } = foePlan({ map, partyZone, distanceRoll: 1 });
  const pcs = layoutTokens({ zone: partyZone, count: 4, bounds: [0, 0, 2200, 1600] });
  const foes = layoutTokens({ zone, count: 10, from, occupied: pcs.map((p) => rectOf(p)), bounds: [0, 0, 2200, 1600] });
  assert.ok(foes.every((p) => inside(p, 1, zone)));
  assert.ok(pcs.every((p) => inside(p, 1, partyZone)));
  assert.ok(noOverlap([...pcs, ...foes]));
});

// ── the record ───────────────────────────────────────────────────────────────

test("newBattleRecord: a staged record with the plan's fields", () => {
  const encounter = { kind: "monster", uuid: "Compendium.x.y.Actor.wolf", name: "Wolf", img: "wolf.webp", count: 4, distanceRoll: 3, activityRoll: 7 };
  const record = newBattleRecord({
    encounter, terrain: "forest", map: { id: "forest-woods" }, variant: "night", originSceneId: "hexScene", hex: "0203",
    now: 1760000000000, id: "battle0000000001", sceneId: "scene1", tokenIds: ["a", "b"],
  });
  assert.deepEqual(record, {
    id: "battle0000000001", at: 1760000000000, status: BATTLE_STATUS.staged, originSceneId: "hexScene", mapId: "forest-woods",
    sceneId: "scene1", variant: "night", terrain: "forest", hex: "0203", tokenIds: ["a", "b"], presentTokenIds: [], combatId: null,
    encounter: { name: "Wolf", uuid: "Compendium.x.y.Actor.wolf", count: 4, distanceRoll: 3 },
  });
});

test("newBattleRecord: the party already on the scene is listed apart from the tokens the battle placed", () => {
  const present = ["p1", "p2"];
  const record = newBattleRecord({ tokenIds: ["t1"], presentTokenIds: present });
  present.push("p3");
  assert.deepEqual(record.presentTokenIds, ["p1", "p2"], "copied, not shared");
  assert.deepEqual(record.tokenIds, ["t1"]);
  assert.deepEqual(newBattleRecord().presentTokenIds, []);
});

test("newBattleRecord: defaults for a battle on a world scene with no hex and no encounter", () => {
  const record = newBattleRecord({ now: 5 });
  assert.equal(record.status, "staged");
  assert.equal(record.at, 5);
  assert.equal(record.mapId, null);
  assert.equal(record.sceneId, null);
  assert.equal(record.originSceneId, null);
  assert.equal(record.hex, null);
  assert.equal(record.terrain, null);
  assert.equal(record.variant, "day");
  assert.deepEqual(record.tokenIds, []);
  assert.equal(record.combatId, null);
  assert.deepEqual(record.encounter, { name: "", uuid: null, count: 0, distanceRoll: null });
  assert.match(record.id, /^[A-Za-z0-9]{16}$/);
});

test("newBattleRecord: ids differ, tokenIds are copied, the encounter is not shared", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newBattleRecord().id));
  assert.equal(ids.size, 50);
  const tokenIds = ["a"];
  const encounter = { uuid: "u", name: "n", count: 2, distanceRoll: 1 };
  const record = newBattleRecord({ tokenIds, encounter });
  tokenIds.push("b");
  encounter.count = 99;
  assert.deepEqual(record.tokenIds, ["a"]);
  assert.equal(record.encounter.count, 2);
});

test("newBattleRecord: a missing count is one, a missing distance is null (not zero)", () => {
  assert.equal(newBattleRecord({ encounter: { uuid: "u", name: "n" } }).encounter.count, 1);
  assert.equal(newBattleRecord({ encounter: { uuid: "u", name: "n", count: 0 } }).encounter.count, 1);
  assert.equal(newBattleRecord({ encounter: { uuid: "u", name: "n", distanceRoll: null } }).encounter.distanceRoll, null);
  assert.equal(newBattleRecord({ encounter: { uuid: "u", name: "n", distanceRoll: 4 } }).encounter.distanceRoll, 4);
});

// ── which tokens a battle owns ───────────────────────────────────────────────

const token = (id, battleId, extra = {}) => ({ id, flags: battleId === undefined ? {} : { [MOD]: { [FLAGS.token]: battleId, ...extra } } });

test("tokensToRemove: exactly the ids that are in the record and carry its flag", () => {
  const record = { id: "B1", tokenIds: ["t1", "t2", "t3"] };
  const docs = [token("t1", "B1"), token("t2", "B1"), token("t3", "B1"), token("t4", "B1"), token("gm1", undefined)];
  assert.deepEqual(tokensToRemove(record, docs), ["t1", "t2", "t3"]);
});

test("tokensToRemove: ignores a token whose flag names a different battle", () => {
  const record = { id: "B1", tokenIds: ["t1", "t2"] };
  const docs = [token("t1", "B1"), token("t2", "B2")];
  assert.deepEqual(tokensToRemove(record, docs), ["t1"]);
});

test("tokensToRemove: ignores a flagged token whose id is not in the record", () => {
  const record = { id: "B1", tokenIds: ["t1"] };
  const docs = [token("t1", "B1"), token("stray", "B1")];
  assert.deepEqual(tokensToRemove(record, docs), ["t1"]);
});

test("tokensToRemove: a listed token that lost its flag, or never had it, stays", () => {
  const record = { id: "B1", tokenIds: ["t1", "t2", "t3"] };
  const docs = [token("t1", undefined), { id: "t2", flags: { "other-module": { battleToken: "B1" } } }, { id: "t3" }];
  assert.deepEqual(tokensToRemove(record, docs), []);
});

test("tokensToRemove: nothing to go on removes nothing", () => {
  const docs = [token("t1", undefined), token("t2", "B1")];
  assert.deepEqual(tokensToRemove(null, docs), []);
  assert.deepEqual(tokensToRemove(undefined, docs), []);
  assert.deepEqual(tokensToRemove({}, docs), []);
  assert.deepEqual(tokensToRemove({ id: "B1" }, docs), []);
  assert.deepEqual(tokensToRemove({ id: "B1", tokenIds: [] }, docs), []);
  assert.deepEqual(tokensToRemove({ tokenIds: ["t1"] }, docs), [], "a record with no id must not match tokens with no flag");
  assert.deepEqual(tokensToRemove({ id: "B1", tokenIds: ["t2"] }, undefined), []);
  assert.deepEqual(tokensToRemove({ id: "B1", tokenIds: ["t2"] }, []), []);
});

test("tokensToRemove: takes a Foundry-style collection and lists each id once", () => {
  const record = { id: "B1", tokenIds: ["t1", "t2", "t1"] };
  const collection = new Map([["t1", token("t1", "B1")], ["t2", token("t2", "B1")]]).values();
  assert.deepEqual(tokensToRemove(record, collection), ["t1", "t2"]);
  assert.deepEqual(tokensToRemove(record, [token("t1", "B1"), token("t1", "B1")]), ["t1"]);
});

test("tokensToRemove: a party token that was already on the scene is never in the list, even carrying the flag", () => {
  const record = { id: "B1", tokenIds: ["t1"], presentTokenIds: ["p1"] };
  const docs = [token("t1", "B1"), token("p1", "B1"), token("p2", undefined)];
  assert.deepEqual(tokensToRemove(record, docs), ["t1"]);
  assert.deepEqual(battleTokens(record, docs).map((t) => t.id), ["t1"]);
});

test("battleTokens: the documents themselves, same rule", () => {
  const a = token("t1", "B1"), b = token("t2", "B2");
  assert.deepEqual(battleTokens({ id: "B1", tokenIds: ["t1", "t2"] }, [a, b]), [a]);
});

// ── numbering a batch of tokens ──────────────────────────────────────────────

test("numberedNames: each new token takes the lowest number nobody has, the way Foundry numbers one", () => {
  assert.deepEqual(numberedNames("Wolf", [], 3), ["Wolf (1)", "Wolf (2)", "Wolf (3)"]);
  assert.deepEqual(numberedNames("Wolf", ["Wolf (1)", "Wolf (3)"], 3), ["Wolf (2)", "Wolf (4)", "Wolf (5)"]);
  assert.deepEqual(numberedNames("Wolf", ["Wolf (2)"], 2), ["Wolf (1)", "Wolf (3)"]);
  assert.deepEqual(numberedNames("Wolf", [], 0), []);
});

test("numberedNames: only that actor's own numbering counts", () => {
  // a plain "Wolf", another monster, and a different parenthesis are not "Wolf (n)"
  assert.deepEqual(numberedNames("Wolf", ["Wolf", "Dire Wolf (1)", "Wolf (alpha)", "Wolf (1) extra"], 2), ["Wolf (1)", "Wolf (2)"]);
});

test("numberedNames: a name with characters that mean something in a pattern is matched literally", () => {
  assert.deepEqual(numberedNames("Ogre [Big] (Young)", ["Ogre [Big] (Young) (1)"], 1), ["Ogre [Big] (Young) (2)"]);
  assert.deepEqual(numberedNames("A.B", ["AxB (1)"], 1), ["A.B (1)"], "a dot is a dot");
});

// ── a picture for each foe ───────────────────────────────────────────────────

/** A generator that walks a fixed list of rolls, so a shuffle is a known one. */
const rolls = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test("dealPictures: every picture is used before any is used again, and nothing is invented", () => {
  const images = ["a.webp", "b.webp", "c.webp"];
  for (const rng of [rolls(0), rolls(0.99), rolls(0.2, 0.7), Math.random]) {
    const dealt = dealPictures(images, 7, rng);
    assert.equal(dealt.length, 7);
    assert.deepEqual([...dealt.slice(0, 3)].sort(), images, "the first round is each picture once");
    assert.deepEqual([...dealt.slice(3, 6)].sort(), images, "so is the second");
    assert.ok(dealt.every((src) => images.includes(src)));
  }
});

test("dealPictures: two neighbours never match, at the seam of two rounds either", () => {
  // a fresh shuffle opens with the last picture of the round before it about once in four: many deals, so it happens
  for (let n = 0; n < 300; n++) {
    const dealt = dealPictures(["a", "b", "c", "d"], 12);
    for (let i = 1; i < dealt.length; i++) assert.notEqual(dealt[i], dealt[i - 1], `${dealt.join(" ")} at ${i}`);
  }
});

test("dealPictures: one picture is every foe's, and no pictures leave the source's own", () => {
  assert.deepEqual(dealPictures(["only.webp"], 3), ["only.webp", "only.webp", "only.webp"]);
  assert.deepEqual(dealPictures([], 3), []);
  assert.deepEqual(dealPictures(undefined, 3), []);
  assert.deepEqual(dealPictures(["a", "b"], 0), []);
  assert.deepEqual(dealPictures(["a", "b"], -2), []);
});

test("dealPictures: a repeated or blank entry is one picture, not two chances at it", () => {
  assert.deepEqual([...dealPictures(["a", "a", "", null, "b"], 2)].sort(), ["a", "b"]);
});

// ── variants and the middle of a map ─────────────────────────────────────────

test("resolveVariant: a chosen variant wins, a camp keeps the clock's night", () => {
  assert.deepEqual(resolveVariant({ variant: "camp", night: true }), { night: true, camping: true });
  assert.deepEqual(resolveVariant({ variant: "camp" }), { night: false, camping: true });
  assert.deepEqual(resolveVariant({ variant: "night", camping: true }), { night: true, camping: false });
  assert.deepEqual(resolveVariant({ variant: "day", night: true, camping: true }), { night: false, camping: false });
  assert.deepEqual(resolveVariant({ night: true, camping: true }), { night: true, camping: true });
  assert.deepEqual(resolveVariant(), { night: false, camping: false });
  assert.deepEqual(resolveVariant({ variant: "weird", night: true }), { night: true, camping: false });
});

test("variantName: camp art, else night, else day", () => {
  assert.equal(variantName({ camp: true, night: true }), "camp");
  assert.equal(variantName({ night: true }), "night");
  assert.equal(variantName({}), "day");
  assert.equal(variantName(), "day");
});

test("centralZone: the middle of the map, centred and on the grid", () => {
  assert.deepEqual(centralZone(4000, 3000), [1400, 1000, 2600, 2000]);
  const [a, b, c, d] = centralZone(2800, 2100, 70);
  assert.ok([a, b, c, d].every((v) => v % 70 === 0));
  assert.equal((a + c) / 2, 1400);
  assert.equal((b + d) / 2, 1050);
  // a map too small for 30% of a square still leaves a square to stand on
  const [x0, y0, x1, y1] = centralZone(200, 200);
  assert.ok(x1 - x0 >= G && y1 - y0 >= G);
});
