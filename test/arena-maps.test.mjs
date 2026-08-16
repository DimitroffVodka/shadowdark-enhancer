/**
 * Arena map library — the eleven bundled battle maps (2-Minute Tabletop) and
 * the scene-name helper.
 *
 * What this pins:
 *   1. INTEGRITY. Every entry is well-formed — unique id, sensible label, a
 *      grid that is a whole number of the image's pixels on at least one axis,
 *      and a positive feet-per-square.
 *   2. THE FILES EXIST. The picker hands the scene builder an image path from
 *      this library; a typo'd name would render a grey scene and no error. Each
 *      entry's image is asserted against the actual asset on disk, so a missing
 *      conversion fails this test.
 *   3. THE DEFAULT IS REAL. DEFAULT_ARENA_MAP_ID names an entry that is there.
 *
 * No book text and no Foundry: this is plain data, and reads as such.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ARENA_MAPS,
  DEFAULT_ARENA_MAP_ID,
  getArenaMap,
} from "../scripts/pit-fighting/arena-maps.mjs";
import { arenaSceneName } from "../scripts/pit-fighting/arena-scene.mjs";

// Repo root is one level up from this test file's directory.
const REPO = fileURLToPath(new URL("../", import.meta.url));
const ASSET_PREFIX = "modules/shadowdark-enhancer/";

describe("arena map library integrity", () => {
  test("ids are unique", () => {
    assert.equal(new Set(ARENA_MAPS.map((m) => m.id)).size, ARENA_MAPS.length);
  });

  test("every entry is well-formed", () => {
    for (const m of ARENA_MAPS) {
      assert.ok(m.id && m.id === m.id.toLowerCase(), `id ${m.id}`);
      assert.ok(m.label?.length, `label ${m.id}`);
      assert.ok(m.image?.startsWith("modules/shadowdark-enhancer/assets/scenes/arena/"), `image ${m.id}`);
      assert.ok(m.width > 0 && m.height > 0, `dims ${m.id}`);
      assert.ok(m.grid > 0, `grid ${m.id}`);
      assert.ok(m.feetPerSquare > 0, `feet ${m.id}`);
      assert.ok(m.source?.startsWith("https://"), `source ${m.id}`);
    }
  });

  test("the grid is a whole number of the image's pixels on at least one axis", () => {
    for (const m of ARENA_MAPS) {
      const cols = m.width / m.grid;
      const rows = m.height / m.grid;
      const whole = (n) => Math.abs(n - Math.round(n)) < 1e-6;
      assert.ok(whole(cols) || whole(rows), `${m.id}: grid ${m.grid} fits neither axis`);
    }
  });

  /**
   * Foundry's `grid.size` is a NumberField with `integer: true` and `min: 20`,
   * so a fractional cell is ROUNDED ON WRITE with no error. Greybanner Coliseum
   * shipped as 43.75 and silently became 44, putting the lattice a quarter of a
   * square off the painted grid. Divisibility alone does not catch that — 43.75
   * divides 1925 exactly — so the integer-ness is asserted separately.
   */
  test("every grid is an integer Foundry can actually store", () => {
    for (const m of ARENA_MAPS) {
      assert.ok(Number.isInteger(m.grid), `${m.id}: grid ${m.grid} is fractional; Foundry rounds it on write`);
      assert.ok(m.grid >= 20, `${m.id}: grid ${m.grid} is below Foundry's minimum of 20`);
    }
  });

  test("every image file exists on disk", () => {
    for (const m of ARENA_MAPS) {
      assert.ok(existsSync(`${REPO}${m.image.slice(ASSET_PREFIX.length)}`), `file ${m.id} (${m.image})`);
    }
  });
});

describe("arena map lookup", () => {
  test("getArenaMap finds an id and rejects an unknown one", () => {
    assert.equal(getArenaMap("greybanner-arena")?.label, "Greybanner Arena");
    assert.equal(getArenaMap("no-such-map"), null);
  });

  test("the default is a real entry", () => {
    assert.ok(getArenaMap(DEFAULT_ARENA_MAP_ID), `default ${DEFAULT_ARENA_MAP_ID}`);
  });
});

describe("arenaSceneName", () => {
  test("derives from the map label", () => {
    assert.equal(arenaSceneName({ label: "Greybanner Arena" }), "Arena: Greybanner Arena");
  });
});