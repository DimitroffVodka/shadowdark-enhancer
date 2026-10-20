/** The landing table's pure parts: which props show, the click map, the seats, the perspective quads, the tome, the dial. */
import test from "node:test";
import assert from "node:assert/strict";
import { BUTTON_PROPS, HIT_ORDER, SEATS_MAX, TABLE, dialAngle, framesFor, homography, propAtHit, sizeOfGround, tableProps, tomePages } from "../scripts/town/landing-table-core.mjs";

const page = (over = {}) => ({ places: ["quests", "journals", "recaps", "party", "map", "carouse"], games: { on: true }, ...over });

test("every button prop has a box in the render's layout", () => {
  for (const id of BUTTON_PROPS) assert.ok(TABLE.layout.props[id], id);
  assert.equal(TABLE.layout.frames.length, SEATS_MAX);
  for (const f of TABLE.layout.frames) assert.equal(f.face.length, 4);
});

test("the props shown: the tiles left on, games when offered, the market when it has a merchant", () => {
  assert.deepEqual(tableProps(page(), { hasMerchant: true }).map((p) => p.id), ["quests", "market", "games", "carouse", "map", "journals", "recaps"]);
  assert.deepEqual(tableProps(page({ games: { on: false }, places: ["quests"] }), { hasMerchant: false }).map((p) => p.id), ["quests"]);
  const p = tableProps(page(), { hasMerchant: true, labels: { quests: { name: "Quest Log", disabled: false } } })[0];
  assert.equal(p.name, "Quest Log");
  assert.ok(/\/props\/quests\.webp\?v=\w+$/.test(p.src) && Number.isFinite(p.x) && Number.isFinite(p.w));
});

test("the click map names the prop or portrait frame under a pixel, a few grey levels off still rounding right", () => {
  const step = TABLE.layout.hitStep;
  assert.ok(step * HIT_ORDER.length <= 255, "every entry fits a grey level");
  assert.equal(propAtHit(0), null);
  assert.equal(propAtHit(step), HIT_ORDER[0]);
  assert.equal(propAtHit(2 * step + 2), HIT_ORDER[1]);
  assert.equal(propAtHit(11 * step), "recaps");
  assert.equal(propAtHit(12 * step - 3), "seat0");
  assert.equal(propAtHit(17 * step), "seat5");
  assert.equal(propAtHit(18 * step), null);
});

test("the party's portrait frames: one per member, six at most, each with its own cut-out and face", () => {
  assert.equal(framesFor(0).length, 0);
  assert.equal(framesFor(9).length, SEATS_MAX);
  const [first] = framesFor(1);
  assert.equal(first.index, 0);
  assert.ok(/\/props\/seat0\.webp\?v=\w+$/.test(first.src) && first.face.length === 4 && first.w > 0);
});

test("the perspective matrix lays a box's corners exactly on the quad", () => {
  const quad = [[100, 50], [400, 70], [450, 300], [80, 260]];
  const m = homography(200, 100, quad).match(/matrix3d\((.*)\)/)[1].split(",").map(Number);
  const apply = (x, y) => { const X = m[0] * x + m[4] * y + m[12], Y = m[1] * x + m[5] * y + m[13], W = m[3] * x + m[7] * y + m[15]; return [X / W, Y / W]; };
  for (const [[x, y], [u, v]] of [[[0, 0], quad[0]], [[200, 0], quad[1]], [[200, 100], quad[2]], [[0, 100], quad[3]]]) {
    const [X, Y] = apply(x, y);
    assert.ok(Math.abs(X - u) < 1e-3 && Math.abs(Y - v) < 1e-3, `${x},${y}`);
  }
});

test("the tome: each quest's name, then its visible steps with their ticks, shared out over both pages", () => {
  const quests = [
    { name: "Rats", status: "active", objectives: [{ text: "Find the nest", done: true }, { text: "Hidden", secret: true }, { text: "Sub", parent: "x" }, { text: "Burn it", done: false }] },
    { name: "Ghost", status: "active", objectives: [] },
  ];
  const [left, right] = tomePages(quests);
  assert.deepEqual(left.map((l) => [l.kind, l.text, l.done]), [["quest", "Rats", false], ["step", "Find the nest", true], ["step", "Burn it", false]]);
  assert.deepEqual(right.map((l) => l.text), ["Ghost"]);
  assert.deepEqual(tomePages([]), [[], []]);
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `Q${i}`, objectives: [{ text: "a" }, { text: "b" }] }));
  const [l5, r5] = tomePages(many, 8);
  assert.equal(l5.length, 8, "a page holds what it can");
  assert.deepEqual(r5.filter((x) => x.kind === "quest").map((x) => x.text), ["Q3", "Q4"]);
});

test("the dial: noon at the top, midnight at the bottom, a quarter turn every six hours", () => {
  assert.deepEqual([12, 18, 0, 6, 30, -6].map(dialAngle), [0, 90, 180, 270, 270, 90]);
});

test("a hex's ground is a settlement size only for the four settlement words", () => {
  assert.deepEqual(["village", "town", "city", "city_state", "forest", undefined].map(sizeOfGround), ["village", "town", "city", "city_state", null, null]);
});
