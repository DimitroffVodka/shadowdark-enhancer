import test from "node:test";
import assert from "node:assert/strict";
import { assignRegionColors, REGION_COLORS, regionColor, extrasPalette } from "../scripts/hex-map/tag-overlay.mjs";
import { neighbourNumbers } from "../scripts/hex-map/region-scan.mjs";

// Invented fixtures (D1): made-up region names on a small patch of hexes.

/** Colour every hex of columns 10-13, rows 0-3, by the region given per column. */
const byColumn = (names) => {
  const m = new Map();
  for (let c = 10; c < 10 + names.length; c++) for (let r = 0; r < 4; r++) m.set(c * 100 + r, names[c - 10]);
  return m;
};

test("no two touching regions get the same colour", () => {
  const keyByNum = byColumn(["A", "B", "C", "D"]);
  const colors = assignRegionColors(keyByNum);
  for (const [num, key] of keyByNum) {
    for (const n of neighbourNumbers(num)) {
      const other = keyByNum.get(n);
      if (other === undefined || other === key) continue;
      assert.notEqual(colors.get(key), colors.get(other), `${key} and ${other} touch and share a colour`);
    }
  }
});

test("colours are spread, not minimised: distinct regions look distinct", () => {
  // A and C never touch, so first-fit would give them the same colour and the
  // map would read as two colours. With a palette this size they should differ.
  const colors = assignRegionColors(byColumn(["A", "B", "C", "D"]));
  assert.equal(new Set(colors.values()).size, 4);
});

test("a palette smaller than the map still never repeats next door", () => {
  const tiny = [0x111111, 0x222222, 0x333333];
  const keyByNum = byColumn(["A", "B", "C", "D", "E"]);
  const colors = assignRegionColors(keyByNum, { palette: tiny });
  for (const [num, key] of keyByNum) {
    for (const n of neighbourNumbers(num)) {
      const other = keyByNum.get(n);
      if (other === undefined || other === key) continue;
      assert.notEqual(colors.get(key), colors.get(other));
    }
  }
});

test("the same map always paints the same way", () => {
  const a = assignRegionColors(byColumn(["A", "B", "C", "D"]));
  const b = assignRegionColors(byColumn(["A", "B", "C", "D"]));
  assert.deepEqual([...a].sort(), [...b].sort());
});

test("every colour comes from the palette", () => {
  const colors = assignRegionColors(byColumn(["A", "B", "C"]));
  for (const c of colors.values()) assert.ok(REGION_COLORS.includes(c), `${c} is not a palette colour`);
});

test("unnamed enclosures are coloured like anything else", () => {
  const colors = assignRegionColors(byColumn(["#7", "Sablewood", "#9"]));
  assert.equal(colors.size, 3);
  assert.notEqual(colors.get("#7"), colors.get("Sablewood"));
});

test("nothing to colour is not an error", () => {
  assert.equal(assignRegionColors(new Map()).size, 0);
  assert.equal(assignRegionColors(undefined).size, 0);
});

test("the hashed fallback still answers for a lone name", () => {
  assert.ok(REGION_COLORS.includes(regionColor("Sablewood")));
  assert.equal(regionColor("Sablewood"), regionColor("sablewood"));   // case does not change it
});

// ── Extras' palette, when it offers one ──────────────────────────────────────

const withExtras = (getZoneColors) => {
  const saved = globalThis.game;
  globalThis.game = getZoneColors ? { shadowdarkExtras: { hex: { getZoneColors } } } : {};
  return () => { globalThis.game = saved; };
};

test("Extras' palette is used when it offers one", () => {
  const restore = withExtras(() => [
    { value: "", label: "Default", hex: "#00cc44" },     // "no colour set", not a colour
    { value: "#e74c3c", label: "Red", hex: "#e74c3c" },
    { value: "#1e7e34", label: "Forest", hex: "#1e7e34" },
  ]);
  try {
    assert.deepEqual(extrasPalette(), [0xe74c3c, 0x1e7e34]);
  } finally { restore(); }
});

test("no Extras, a broken accessor, or an unusable list all fall back", () => {
  let restore = withExtras(null);
  try { assert.equal(extrasPalette(), null); } finally { restore(); }
  restore = withExtras(() => { throw new Error("feature off mid-session"); });
  try { assert.equal(extrasPalette(), null); } finally { restore(); }
  restore = withExtras(() => [{ value: "green" }, { value: "#1e7e3" }, { value: "" }]);
  try { assert.equal(extrasPalette(), null, "nothing usable is not an empty palette"); } finally { restore(); }
});

test("a colour Extras offers still never lands next to itself", () => {
  const restore = withExtras(() => [{ value: "#e74c3c" }, { value: "#1e7e34" }, { value: "#3498db" }]);
  try {
    const keyByNum = byColumn(["A", "B", "C"]);
    const colors = assignRegionColors(keyByNum, { palette: extrasPalette() });
    assert.equal(new Set(colors.values()).size, 3);
    for (const c of colors.values()) assert.ok([0xe74c3c, 0x1e7e34, 0x3498db].includes(c));
  } finally { restore(); }
});
