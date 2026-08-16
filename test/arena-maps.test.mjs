/**
 * Arena map library — the twelve bundled battle maps (2-Minute Tabletop) and
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
      assert.ok(m.image?.startsWith("modules/shadowdark-enhancer/assets/scenes/"), `image ${m.id}`);
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

/**
 * The Tavern Cellar is the one entry the scene builder treats differently, and
 * the docs promise it by name. These pin the shape the builder reads — a floor
 * missing its image, or elevation bands that do not meet, would produce a scene
 * that looks built and cannot be walked between.
 */
describe("multi-level maps", () => {
  const multi = ARENA_MAPS.filter((m) => m.floors?.length);

  test("the documented Tavern Cellar is actually in the library", () => {
    const cellar = getArenaMap("tavern-cellar");
    assert.ok(cellar, "tavern-cellar is missing; CHANGELOG, README and the wiki all promise it");
    assert.equal(cellar.floors?.length, 2);
    assert.ok(cellar.venueRows.includes(1), "the cellar must answer venue row 1");
  });

  test("every floor is well-formed and its art exists", () => {
    for (const m of multi) {
      for (const f of m.floors) {
        assert.ok(f.name?.length, `${m.id}: floor name`);
        assert.ok(f.image?.startsWith("modules/shadowdark-enhancer/assets/scenes/"), `${m.id}: ${f.name} image`);
        assert.ok(existsSync(`${REPO}${f.image.slice(ASSET_PREFIX.length)}`), `${m.id}: ${f.name} file missing`);
        assert.ok(Number.isFinite(f.bottom) && Number.isFinite(f.top), `${m.id}: ${f.name} elevation`);
        assert.ok(f.top > f.bottom, `${m.id}: ${f.name} is inside out`);
      }
    }
  });

  test("floors stack without a gap or an overlap", () => {
    for (const m of multi) {
      const sorted = [...m.floors].sort((a, b) => a.bottom - b.bottom);
      for (let i = 1; i < sorted.length; i++) {
        assert.equal(sorted[i].bottom, sorted[i - 1].top,
          `${m.id}: ${sorted[i - 1].name} ends at ${sorted[i - 1].top} but ${sorted[i].name} starts at ${sorted[i].bottom}`);
      }
    }
  });

  test("the map's own image is one of its floors", () => {
    for (const m of multi) {
      assert.ok(m.floors.some((f) => f.image === m.image),
        `${m.id}: the thumbnail image is not any floor's background`);
    }
  });

  /**
   * A changeLevel region offers every level it is assigned to EXCEPT the one the
   * token stands on, so a stair is only useful where there are at least two
   * floors to choose between — and a polygon needs 3+ points to enclose an area.
   */
  test("a stair is a real polygon on a map with somewhere to go", () => {
    for (const m of multi) {
      if (!m.stair) continue;
      assert.ok(m.floors.length >= 2, `${m.id}: a stair needs two floors`);
      assert.equal(m.stair.length % 2, 0, `${m.id}: stair points must be x,y pairs`);
      assert.ok(m.stair.length >= 6, `${m.id}: a polygon needs at least 3 points`);
      for (let i = 0; i < m.stair.length; i += 2) {
        assert.ok(m.stair[i] >= 0 && m.stair[i] <= m.width, `${m.id}: stair x out of bounds`);
        assert.ok(m.stair[i + 1] >= 0 && m.stair[i + 1] <= m.height, `${m.id}: stair y out of bounds`);
      }
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

  // Kept for entries that carry no venue label. NOT for findArenaScene, which
  // now resolves the map first — it used to hand this function a bare
  // `{label: mapId}`, which asked for "Arena: dungeon-fighting-pit" and matched
  // nothing.
  test("falls back to the label when there is no venue label", () => {
    assert.equal(arenaSceneName({ label: "Greybanner Arena" }), "Arena: Greybanner Arena");
  });

  // Every id is a slug; no scene is named after one. If a derived name ever
  // equals a bare id again, the by-name lookup has regressed to matching nothing.
  test("no derived name is just a map id", () => {
    for (const m of ARENA_MAPS) {
      assert.notEqual(arenaSceneName(m), `Arena: ${m.id}`, `${m.id}: name is the slug`);
    }
  });

  test("every library entry yields a distinct scene name", () => {
    const names = ARENA_MAPS.map((m) => arenaSceneName(m));
    assert.equal(new Set(names).size, names.length);
  });
});