import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  ARENA_LOOKS, RING_BANDS, RING_FEET, RINGS_TILE_PATH, arenaGeometry, arenaLayout, arenaLookById, defaultLook, fightView, foeRowRadii, isArenaLook,
} from "../scripts/stage/arena-core.mjs";

const ROW_FT = { close: 12.5, near: 37.5, far: 70 };   // written out here so a wrong radius in the code fails
const MOD = "modules/shadowdark-enhancer/";

function webpSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  const v = b.readUInt32LE(21);   // VP8L
  return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
}

test("constants and looks", () => {
  assert.deepEqual([...RING_BANDS], ["close", "near", "far"]);
  assert.deepEqual({ ...RING_FEET }, { close: 15, near: 40, far: 70 });
  assert.ok(RINGS_TILE_PATH.endsWith("arena-fight/rings.webp"));
  assert.deepEqual(ARENA_LOOKS.map((l) => l.id), ["arena-pit", "arena-coliseum", "arena-ring", "arena-tavern", "arena-town", "arena-market"]);
  assert.equal(new Set(ARENA_LOOKS.map((l) => l.id)).size, 6);
  assert.deepEqual(ARENA_LOOKS.map((l) => l.labelKey).slice(0, 2), ["SDE.stage.arena.lookPit", "SDE.stage.arena.lookColiseum"]);
  assert.ok(Object.isFrozen(ARENA_LOOKS) && ARENA_LOOKS.every(Object.isFrozen));
  assert.equal(arenaLookById("arena-pit").width, 3080);
  assert.equal(arenaLookById("nope"), null);
  assert.ok(isArenaLook("arena-town") && !isArenaLook("greybanner-arena"));
});

test("look sizes match the shipped picture files", () => {
  for (const l of ARENA_LOOKS) {
    assert.ok(Number.isInteger(l.width) && l.width > 0 && Number.isInteger(l.height) && l.height > 0, l.id);
    const f = l.image.replace(MOD, "");
    if (existsSync(f)) assert.deepEqual(webpSize(f), [l.width, l.height], l.id);
  }
});

test("defaultLook follows the shown ready place", () => {
  assert.equal(defaultLook(null).id, "arena-pit");
  assert.equal(defaultLook(undefined).id, "arena-pit");
  assert.equal(defaultLook({ shown: false, place: "ready-tavern" }).id, "arena-pit");
  assert.equal(defaultLook({ shown: true, place: "camp" }).id, "arena-pit");
  assert.equal(defaultLook({ shown: true, place: "ready-tavern" }).id, "arena-tavern");
  assert.equal(defaultLook({ shown: true, place: "ready-town" }).id, "arena-town");
  assert.equal(defaultLook({ shown: true, place: "ready-market" }).id, "arena-market");
});

test("geometry per look", () => {
  for (const l of ARENA_LOOKS) {
    const G = arenaGeometry(l.width, l.height);
    const S = Math.min(l.width, l.height);
    assert.equal(G.S, S);
    assert.equal(G.g, Math.round(S / 32));
    for (const b of RING_BANDS) assert.ok(Math.abs(G.rings[b] * 5 / G.g - RING_FEET[b]) < 1e-9);
    assert.deepEqual(G.tile, { x: l.width / 2 - S / 2, y: l.height / 2 - S / 2, width: S, height: S });
    assert.equal(G.labels.length, 3);
    for (const lab of G.labels) {
      assert.ok(Math.abs(lab.x - (G.cx + G.rings[lab.band] + G.g * 0.25)) < 1e-9, "3 o'clock, beside its ring");
      assert.equal(lab.y, G.cy);
      assert.equal(lab.fontSize, Math.round(0.9 * G.g));
    }
  }
  const words = { close: "Close", near: "Near", far: "Far" };
  for (const l of ARENA_LOOKS) {
    const G = arenaGeometry(l.width, l.height);
    const boxes = G.labels.map((lab) => ({ ...lab, w: 0.6 * lab.fontSize * words[lab.band].length }));
    boxes.forEach((b, i) => {
      const r = G.cx + G.rings[b.band], next = boxes[i + 1] && G.cx + G.rings[boxes[i + 1].band];
      assert.ok(b.x > r, `${l.id} ${b.band}: right of its ring`);
      assert.ok(b.x + b.w <= G.cx * 2 && b.y - b.fontSize / 2 >= 0 && b.y + b.fontSize / 2 <= G.cy * 2, `${l.id} ${b.band}: inside the picture`);
      if (next) assert.ok(b.x + b.w < next - G.g * 0.25, `${l.id} ${b.band}: clear of the next ring`);
    });
  }
  const pit = arenaGeometry(3080, 2240);
  assert.deepEqual([pit.g, pit.rings.close, pit.rings.near, pit.rings.far, pit.tile.x], [70, 210, 560, 980, 420]);
});

const sizes = (n, s = 1) => Array(n).fill(s);
const centre = (tl, s, g) => ({ x: tl.x + s * g / 2, y: tl.y + s * g / 2 });

function check(G, pcSizes, foeSizes, band) {
  const out = arenaLayout({ geometry: G, pcSizes, foeSizes, band });
  assert.equal(out.pcs.length, pcSizes.length);
  assert.equal(out.foes.length, foeSizes.length);
  const all = [...out.pcs.map((p, i) => ({ ...p, s: pcSizes[i] })), ...out.foes.map((p, i) => ({ ...p, s: foeSizes[i] }))];
  for (const t of all) {
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.s * G.g <= G.cx * 2 && t.y + t.s * G.g <= G.cy * 2, "inside the picture");
  }
  const cs = all.map((t) => centre(t, t.s, G.g));
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
    assert.ok(d >= (all[i].s + all[j].s) / 2 * G.g * 0.99, `overlap ${i}/${j}`);
  }
  assert.deepEqual(arenaLayout({ geometry: G, pcSizes, foeSizes, band }), out);
  return out;
}

test("layout: 1-8 PCs x foe counts x bands, first row first and on its radius", () => {
  const G = arenaGeometry(3080, 2240);
  for (let n = 1; n <= 8; n++) for (const band of RING_BANDS) for (const f of [1, 3, 8, 20, 60]) {
    const out = check(G, sizes(n), sizes(f), band);
    const radiiFt = out.foes.map((t) => {
      const c = centre(t, 1, G.g);
      return Math.hypot(c.x - G.cx, c.y - G.cy) * 5 / G.g;
    });
    const rows = foeRowRadii(band);
    for (const r of radiiFt) assert.ok(rows.some((x) => Math.abs(x - r) < 0.1), `row radius ${r}`);
    if (f <= 3) for (const r of radiiFt) assert.ok(Math.abs(r - ROW_FT[band]) < 0.1, `first row ${band}: ${r}`);   // a 5 ft error fails
    assert.ok(Math.abs(radiiFt[0] - ROW_FT[band]) < 0.1);
  }
});

test("layout: further foe rows step -5, +5, -10 ... ft from the band row, written out by hand", () => {
  assert.deepEqual(foeRowRadii("near").slice(0, 7), [37.5, 32.5, 42.5, 27.5, 47.5, 22.5, 52.5]);
});

test("layout: party shape", () => {
  const G = arenaGeometry(1584, 1152);
  const one = arenaLayout({ geometry: G, pcSizes: [1], foeSizes: [], band: null }).pcs[0];
  assert.deepEqual(centre(one, 1, G.g), { x: G.cx, y: G.cy });
  const four = arenaLayout({ geometry: G, pcSizes: sizes(4), foeSizes: [], band: null }).pcs;
  assert.ok(Math.abs(centre(four[0], 1, G.g).x - G.cx) < 0.01 && centre(four[0], 1, G.g).y < G.cy);   // 12 o'clock first
  const r = Math.hypot(centre(four[1], 1, G.g).x - G.cx, centre(four[1], 1, G.g).y - G.cy) * 5 / G.g;
  assert.ok(Math.abs(r - 5 / (2 * Math.sin(Math.PI / 4))) < 0.1);
  check(G, sizes(12), sizes(5), "near");   // more than 8 PCs: none lost
});

test("layout: mixed sizes and null band", () => {
  const G = arenaGeometry(1584, 1152);
  const out = check(G, sizes(4), [2, 1, 2, 1], null);
  const c = centre(out.foes[0], 2, G.g);
  assert.ok(Math.abs(Math.hypot(c.x - G.cx, c.y - G.cy) * 5 / G.g - 37.5) < 0.1);   // null = near
});

test("layout: exhausted rows stack at 6 o'clock and lose nothing", () => {
  const G = arenaGeometry(1152, 1152);
  const out = arenaLayout({ geometry: G, pcSizes: sizes(4), foeSizes: sizes(400), band: "far" });
  assert.equal(out.foes.length, 400);
  assert.ok(out.foes.every((t) => t.x >= 0 && t.y >= 0 && t.x + G.g <= 1152 && t.y + G.g <= 1152));
});

test("layout: occupied tokens count as placed before the party and the foes", () => {
  const G = arenaGeometry(3080, 2240);
  const base = arenaLayout({ geometry: G, pcSizes: sizes(4), foeSizes: sizes(3), band: "near" });
  assert.deepEqual(arenaLayout({ geometry: G, pcSizes: sizes(4), foeSizes: sizes(3), band: "near", occupied: [] }), base, "omitted or empty: unchanged");
  const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) >= G.g - 1e-6;

  // a token on the first foe's 6 o'clock slot: that foe goes to the next slot, the rest are still clear of it
  const spot = centre(base.foes[0], 1, G.g);
  const out = arenaLayout({ geometry: G, pcSizes: sizes(4), foeSizes: sizes(3), band: "near", occupied: [{ ...spot, s: 1 }] });
  assert.notDeepEqual(out.foes[0], base.foes[0]);
  for (const t of out.foes) assert.ok(apart(centre(t, 1, G.g), spot));
  assert.deepEqual(out.pcs, base.pcs, "the party did not move");

  // a token on a party circle spot: that PC moves to a free slot, the others keep their spots
  const pc = centre(base.pcs[0], 1, G.g);
  const moved = arenaLayout({ geometry: G, pcSizes: sizes(4), foeSizes: [], band: "near", occupied: [{ ...pc, s: 1 }] });
  assert.ok(apart(centre(moved.pcs[0], 1, G.g), pc));
  assert.deepEqual(moved.pcs.slice(1), base.pcs.slice(1));
});

test("fightView: frames every token for all looks, bands and party / foe counts", () => {
  for (const look of ARENA_LOOKS) {
    const geometry = arenaGeometry(look.width, look.height);
    const { g } = geometry, minScale = 22 / g, maxScale = 50 / g;
    for (const band of ["close", "near", "far", null]) for (const np of [1, 4, 8]) for (const nf of [1, 3, 20]) {
      const lay = arenaLayout({ geometry, pcSizes: Array(np).fill(1), foeSizes: Array(nf).fill(1), band });
      const placements = { pcs: lay.pcs.map((p) => ({ ...p, s: 1 })), foes: lay.foes.map((p) => ({ ...p, s: 1 })) };
      const v = fightView({ geometry, placements });
      assert.deepEqual(fightView({ geometry, placements }), v, "identical twice");
      assert.ok(v.scale >= minScale - 1e-9 && v.scale <= maxScale + 1e-9, `${look.id} scale in range`);
      assert.ok(v.x >= 0 && v.x <= look.width && v.y >= 0 && v.y <= look.height, "centre inside the picture");
      if (v.scale > minScale + 1e-9) {   // not floored: the whole fight fits the 1000 x 560 box
        const halfW = 500 / v.scale, halfH = 280 / v.scale;
        for (const t of [...placements.pcs, ...placements.foes]) {
          const tx = t.x + g / 2, ty = t.y + g / 2;
          if (v.x - halfW > 0 && v.x + halfW < look.width) assert.ok(Math.abs(tx - v.x) <= halfW, `${look.id} ${band} ${np}/${nf} x`);
          if (v.y - halfH > 0 && v.y + halfH < look.height) assert.ok(Math.abs(ty - v.y) <= halfH, `${look.id} ${band} ${np}/${nf} y`);
        }
      }
    }
  }
});

test("fightView: Far with 3 foes frames the Far row, Close and party-only get maxScale on the party", () => {
  const geometry = arenaGeometry(3080, 2240);
  const place = (band, nf) => {
    const lay = arenaLayout({ geometry, pcSizes: [1, 1, 1], foeSizes: Array(nf).fill(1), band });
    return { pcs: lay.pcs.map((p) => ({ ...p, s: 1 })), foes: lay.foes.map((p) => ({ ...p, s: 1 })) };
  };
  const far = place("far", 3);
  const v = fightView({ geometry, placements: far });
  assert.ok(v.scale < 50 / geometry.g, "zoomed out for Far");
  const bottom = Math.max(...far.foes.map((f) => f.y + geometry.g));
  assert.ok(bottom <= v.y + 280 / v.scale, "the lowest foe is inside the frame");
  const close = fightView({ geometry, placements: place("close", 3) });
  assert.equal(close.scale, 50 / geometry.g);
  const partyOnly = place("far", 0);
  const p = fightView({ geometry, placements: partyOnly });
  assert.equal(p.scale, 50 / geometry.g);
  assert.ok(Math.abs(p.x - geometry.cx) < geometry.g && Math.abs(p.y - geometry.cy) < geometry.g, "centred on the party");
  // a lone token in a corner: the centre is pulled into the picture
  const corner = fightView({ geometry, placements: { pcs: [{ x: 0, y: 0 }], foes: [{ x: 0, y: 0 }] } });
  assert.ok(corner.x >= 0 && corner.y >= 0);
  assert.equal(fightView({ geometry, placements: {} }).scale, 50 / geometry.g);
});
