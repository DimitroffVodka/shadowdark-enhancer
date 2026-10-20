/** The landing table's pure parts: which props show, the click map, the seats, the perspective quads, the tome, the dial. */
import test from "node:test";
import assert from "node:assert/strict";
import { BUTTON_PROPS, HIT_ORDER, SEATS_MAX, TABLE, dialAngle, homography, propAtHit, seatsFor, sizeOfGround, tableProps, tomePages } from "../scripts/town/landing-table-core.mjs";

const page = (over = {}) => ({ places: ["quests", "journals", "recaps", "party", "map", "carouse"], games: { on: true }, ...over });

test("every button prop has a box in the render's layout", () => {
  for (const id of BUTTON_PROPS) assert.ok(TABLE.layout.props[id], id);
  assert.ok(TABLE.layout.seats.length >= SEATS_MAX);
});

test("the props shown: the tiles left on, games when offered, the market when it has a merchant", () => {
  assert.deepEqual(tableProps(page(), { hasMerchant: true }).map((p) => p.id), ["quests", "market", "games", "carouse", "map", "journals", "recaps"]);
  assert.deepEqual(tableProps(page({ games: { on: false }, places: ["quests"] }), { hasMerchant: false }).map((p) => p.id), ["quests"]);
  const p = tableProps(page(), { hasMerchant: true, labels: { quests: { name: "Quest Log", disabled: false } } })[0];
  assert.equal(p.name, "Quest Log");
  assert.ok(p.src.endsWith("/props/quests.webp") && Number.isFinite(p.x) && Number.isFinite(p.w));
});

test("the click map names the prop under a pixel, 20 grey levels a prop, and a lossy pixel still rounds right", () => {
  assert.equal(propAtHit(0), null);
  assert.equal(propAtHit(20), HIT_ORDER[0]);
  assert.equal(propAtHit(41), HIT_ORDER[1]);
  assert.equal(propAtHit(199), HIT_ORDER[9]);
  assert.equal(propAtHit(220), "recaps");
  assert.equal(propAtHit(240), null);
});

test("the party's seats: the far side first, six at most", () => {
  assert.equal(seatsFor(0).length, 0);
  assert.equal(seatsFor(9).length, SEATS_MAX);
  assert.deepEqual(seatsFor(1)[0], { x: TABLE.layout.seats[0][0], y: TABLE.layout.seats[0][1] });
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

test("the tome: each quest's name, then its visible steps with their ticks, left page first", () => {
  const quests = [
    { name: "Rats", status: "active", objectives: [{ text: "Find the nest", done: true }, { text: "Hidden", secret: true }, { text: "Sub", parent: "x" }, { text: "Burn it", done: false }] },
    { name: "Ghost", status: "active", objectives: [] },
  ];
  const [left, right] = tomePages(quests, 3);
  assert.deepEqual(left.map((l) => [l.kind, l.text, l.done]), [["quest", "Rats", false], ["step", "Find the nest", true], ["step", "Burn it", false]]);
  assert.deepEqual(right.map((l) => l.text), ["Ghost"]);
  assert.deepEqual(tomePages([]), [[], []]);
});

test("the dial: noon at the top, midnight at the bottom, a quarter turn every six hours", () => {
  assert.deepEqual([12, 18, 0, 6, 30, -6].map(dialAngle), [0, 90, 180, 270, 270, 90]);
});

test("a hex's ground is a settlement size only for the four settlement words", () => {
  assert.deepEqual(["village", "town", "city", "city_state", "forest", undefined].map(sizeOfGround), ["village", "town", "city", "city_state", null, null]);
});
