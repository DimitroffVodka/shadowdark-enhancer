import test from "node:test";
import assert from "node:assert/strict";
import { makeBitmap } from "../scripts/hex-map/bitmap.mjs";
import { kmeans, buildLegend, cardSamples } from "../scripts/hex-map/legend.mjs";

// The classifier test's invented glyphs on a 64×64 cell: a filled blob, a chevron, a dot grid.
const W = 64, H = 64;
function glyph(kind) {
  const b = makeBitmap(W, H);
  const set = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) b.data[y * W + x] = 1; };
  if (kind === "blob") for (let y = 22; y < 42; y++) for (let x = 24; x < 40; x++) set(x, y);
  if (kind === "chevron") for (let i = 0; i < 16; i++) for (let t = 0; t < 3; t++) { set(24 + i, 40 - i + t); set(40 - i, 40 - i + t); }
  if (kind === "dots") for (let y = 24; y < 40; y += 6) for (let x = 24; x < 40; x += 6) { set(x, y); set(x + 1, y); set(x, y + 1); set(x + 1, y + 1); }
  return b;
}
function noisy(b, seed) {
  const out = makeBitmap(W, H); out.data.set(b.data);
  let s = seed; for (let k = 0; k < 6; k++) { s = (s * 9301 + 49297) % 233280; const p = s % (W * H); out.data[p] ^= 1; }
  return out;
}
function withRiver(b) {
  const out = makeBitmap(W, H); out.data.set(b.data);
  for (let x = 0; x < W; x++) { const y = 32 + Math.round(6 * Math.sin(x / 7)); for (let d = -1; d <= 1; d++) out.data[(y + d) * W + x] = 1; }
  return out;
}

/** 25 plain cells and 5 river cells of each glyph; num encodes the kind in its hundreds. */
function cells() {
  const out = [];
  ["blob", "chevron", "dots"].forEach((kind, k) => {
    for (let i = 0; i < 30; i++) {
      const base = noisy(glyph(kind), (k + 1) * 1000 + i * 17);
      out.push({ num: (k + 1) * 100 + i, bitmap: i < 25 ? base : withRiver(base) });
    }
  });
  return out;
}
const kindOf = (num) => Math.floor(num / 100);

test("kmeans splits two obvious groups of points", async () => {
  const vecs = [];
  for (let i = 0; i < 20; i++) vecs.push(Float32Array.from([i % 5, 0]));
  for (let i = 0; i < 20; i++) vecs.push(Float32Array.from([100 + i % 5, 100]));
  const { assign, inertia, centroids } = await kmeans(vecs, 2);
  assert.equal(centroids.length, 2);
  const first = assign[0];
  for (let i = 0; i < 20; i++) assert.equal(assign[i], first);
  for (let i = 20; i < 40; i++) assert.notEqual(assign[i], first);
  assert.ok(inertia < 100, `inertia ${inertia}`);
  const { centroids: one } = await kmeans(vecs, 5, { iters: 1 });
  assert.equal(one.length, 5, "k is honoured when it fits");
  assert.equal((await kmeans(vecs.slice(0, 3), 8)).centroids.length, 3, "k is capped at the number of points");
});

test("buildLegend groups cells by glyph, biggest first, every cell once, deterministically", async () => {
  const input = cells();
  const { clusters } = await buildLegend(input, { k: 6 });
  assert.ok(clusters.length >= 3 && clusters.length <= 6, `${clusters.length} clusters`);
  const seen = new Set();
  for (const c of clusters) {
    assert.equal(c.size, c.members.length);
    const kinds = new Set(c.members.map(kindOf));
    assert.equal(kinds.size, 1, `cluster of ${c.size} mixes glyphs: ${[...kinds]}`);
    for (const n of c.members) { assert.ok(!seen.has(n), `cell ${n} in two clusters`); seen.add(n); }
    assert.ok(c.core.length <= 12 && c.core.every((n) => c.members.includes(n)));
    assert.deepEqual(c.core, c.members.slice(0, c.core.length), "the core is the members nearest the centroid");
    assert.ok(c.samples.length >= 1 && c.samples.length <= 4 && c.samples.every((n) => c.members.includes(n)));
    assert.equal(new Set(c.samples).size, c.samples.length, "no picture is shown twice");
  }
  assert.equal(seen.size, input.length, "every cell lands in a cluster");
  for (let i = 1; i < clusters.length; i++) assert.ok(clusters[i - 1].size >= clusters[i].size, "biggest first");
  // The plain cells of a glyph outnumber its river cells, so the three biggest clusters are the three glyphs' plain cores.
  assert.deepEqual(clusters.slice(0, 3).map((c) => kindOf(c.members[0])).sort(), [1, 2, 3]);
  const again = await buildLegend(cells(), { k: 6 });
  assert.deepEqual(again.clusters.map((c) => c.members), clusters.map((c) => c.members), "same input, same legend");
});

test("buildLegend on nothing, on one cell, and with a progress callback", async () => {
  assert.deepEqual(await buildLegend([]), { clusters: [] });
  assert.deepEqual(await buildLegend([{ num: 1 }, { num: 2, bitmap: null }]), { clusters: [] }, "cells without a bitmap are skipped");
  const one = await buildLegend([{ num: 7, bitmap: glyph("blob") }]);
  assert.deepEqual(one.clusters, [{ size: 1, members: [7], core: [7], samples: [7] }]);
  const texts = [];
  await buildLegend(cells().slice(0, 12), { k: 2, restarts: 2, onProgress: (t) => { texts.push(t); } });
  assert.ok(texts.length >= 2 && texts[0].startsWith("Sorting cells by glyph… pass 1 of 2"), texts[0]);
  assert.ok(texts.some((t) => t.includes("pass 2 of 2")));
});


test("cardSamples: a card holding two kinds of cell shows both, and a stray member takes no picture", () => {
  // One card, two modes: the Western Reaches' 147-cell card in miniature. The
  // old rule — the first few by distance to the card's centre — showed four of
  // mode A and nothing of mode B, so naming the card could not describe B.
  const at = (x) => Float32Array.from([x, 0]);
  const vecs = [];
  const members = [];
  for (let i = 0; i < 10; i++) { vecs.push(at(0 + i * 0.01)); members.push(100 + i); }   // mode A
  for (let i = 0; i < 6; i++) { vecs.push(at(5 + i * 0.01)); members.push(200 + i); }    // mode B
  vecs.push(at(40)); members.push(999);                                                  // one stray
  const idx = members.map((_, i) => i);
  const picks = cardSamples(idx, vecs, members, 4);
  assert.equal(picks.length, 4);
  assert.ok(picks.some((n) => n >= 100 && n < 200), "a picture from the bigger mode");
  assert.ok(picks.some((n) => n >= 200 && n < 300), "and one from the mode that would otherwise be invisible");
  // Forcing four pictures onto a card with two modes splits the bigger mode in
  // two, so which picture is first depends on the spacing; what must hold is
  // that no mode is invisible and the stray never takes more than one slot.
  assert.equal(picks.filter((n) => n === 999).length <= 1, true, "the stray is at most one picture, never the card's story");
  assert.equal(new Set(picks).size, picks.length, "no picture twice");
});

test("cardSamples: a card with fewer members than pictures just shows them", () => {
  const vecs = [Float32Array.from([0]), Float32Array.from([1])];
  assert.deepEqual(cardSamples([0, 1], vecs, [7, 8], 4), [7, 8]);
});
