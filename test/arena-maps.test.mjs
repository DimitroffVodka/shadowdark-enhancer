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
  mapsForVenueRow,
} from "../scripts/pit-fighting/arena-maps.mjs";
import { VENUE_ROWS } from "../scripts/pit-fighting/pit-fighting-core.mjs";
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
      assert.ok(m.venueLabel?.length, `venueLabel ${m.id}`);
      assert.ok(Array.isArray(m.venueRows) && m.venueRows.length, `venueRows ${m.id}`);
    }
  });

  /**
   * The picker leads with the rolled venue's maps, so a row with nothing tagged
   * to it would silently fall back to the flat library and quietly lose the
   * feature for that venue. Every row the Venue table can roll must be covered.
   */
  test("every venue row has at least one map, and no row is invented", () => {
    const valid = new Set(VENUE_ROWS.map((r) => r.row));
    for (const m of ARENA_MAPS) {
      for (const r of m.venueRows) {
        assert.ok(valid.has(r), `${m.id}: venue row ${r} is not a row on the Venue table`);
      }
    }
    for (const r of valid) {
      assert.ok(
        ARENA_MAPS.some((m) => m.venueRows.includes(r)),
        `venue row ${r} has no map; the picker would fall back to the flat library`,
      );
    }
  });

  test("venue labels are unique, so the picker never shows two identical rows", () => {
    const labels = ARENA_MAPS.map((m) => m.venueLabel);
    assert.equal(new Set(labels).size, labels.length);
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

describe("mapsForVenueRow", () => {
  test("puts the row's maps first and keeps every other map available", () => {
    for (const { row } of VENUE_ROWS) {
      const { suited, other } = mapsForVenueRow(row);
      assert.ok(suited.length, `row ${row} has no suited map`);
      assert.ok(suited.every((m) => m.venueRows.includes(row)), `row ${row} suited`);
      assert.ok(other.every((m) => !m.venueRows.includes(row)), `row ${row} other`);
      // Reorders, never filters — CS2 lets the GM use any map they like.
      assert.equal(suited.length + other.length, ARENA_MAPS.length, `row ${row} total`);
    }
  });

  test("with no venue rolled, the whole library stands in its own order", () => {
    const { suited, other } = mapsForVenueRow(null);
    assert.equal(suited.length, 0);
    assert.deepEqual(other.map((m) => m.id), ARENA_MAPS.map((m) => m.id));
  });
});

describe("arenaSceneName", () => {
  test("names the scene for the venue, not the product it was sold as", () => {
    assert.equal(
      arenaSceneName({ label: "Greybanner Coliseum (day)", venueLabel: "Large Arena" }),
      "Arena: Large Arena",
    );
  });

  // findArenaScene's by-name fallback passes a bare `{label: mapId}`, so the
  // label path has to keep working for entries with no venue label at all.
  test("falls back to the label when there is no venue label", () => {
    assert.equal(arenaSceneName({ label: "Greybanner Arena" }), "Arena: Greybanner Arena");
  });

  test("every library entry yields a distinct scene name", () => {
    const names = ARENA_MAPS.map((m) => arenaSceneName(m));
    assert.equal(new Set(names).size, names.length);
  });
});