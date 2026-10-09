/**
 * Encounter map library — the battle maps a hex-travel encounter can open, and the
 * pure functions that choose between them.
 *
 * What this pins:
 *   1. INTEGRITY. Every entry is well-formed: a unique id, a label in the strings
 *      file, terrains the hex map knows, a whole number of 100 px squares, a party
 *      zone and a camp fire that are on the picture, and credits that CREDITS.md
 *      repeats.
 *   2. THE FILES EXIST AND ARE THE SIZE CLAIMED. A scene is built from the
 *      library's width and height; a WebP that is some other size would put the
 *      grid off the art with no error. Each image's header is read, not trusted.
 *   3. THE SHIPPED DEFAULT. The first map tagged for a terrain is what an
 *      untouched world opens, so the order is part of the contract.
 *   4. THE CHOICES. Pins, disabled maps and "random" resolve the way the settings
 *      window promises, with the dice injected.
 *   5. WHERE TOKENS START. A party zone, and a foes zone, lies inside ground that
 *      was read off the art: PCs start on dry ground or a boat's deck, never in a
 *      pool, lava or a chasm.
 *   6. THE PREVIEWS. Each map has a small preview the picker draws, of the right
 *      shape and size, and the folders hold nothing the library does not list.
 *
 * No Foundry: this is plain data and pure functions.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  ASSET_DIR,
  FEET_PER_SQUARE,
  GRID_PX,
  NIGHT_DARKNESS,
  TERRAINS,
  WATER_TERRAINS,
} from "../scripts/encounter/battle-maps/constants.mjs";
import {
  ENCOUNTER_MAPS,
  campVariantOf,
  enabledMapsFor,
  getEncounterMap,
  mapsForTerrain,
  normalizePrefs,
  otherMaps,
  partyZone,
  pickVariant,
  resolveDefaultMap,
} from "../scripts/encounter/battle-maps/encounter-maps.mjs";

// Repo root is one level up from this test file's directory.
const REPO = fileURLToPath(new URL("../", import.meta.url));
const onDisk = (modulePath) => `${REPO}${modulePath.slice(`modules/${MODULE_ID}/`.length)}`;
const fileOf = (map) => onDisk(map.image);
const thumbOf = (map) => onDisk(map.thumb);
/** The previews are this many px on the long side (tools/encounter-maps/build-assets.py THUMB_LONG_SIDE). */
const THUMB_LONG_SIDE = 480;

const readJson = (path) => (existsSync(REPO + path) ? JSON.parse(readFileSync(REPO + path, "utf8")) : {});
// The map labels live in languages/en.json.
const STRINGS = readJson("languages/en.json");
const CREDITS = readFileSync(`${REPO}CREDITS.md`, "utf8");

/** [width, height] from the first bytes of a WebP: the lossy, lossless and extended headers each keep it elsewhere. */
function webpSize(file) {
  const head = Buffer.alloc(32);
  const fd = openSync(file, "r");
  readSync(fd, head, 0, 32, 0);
  closeSync(fd);
  assert.equal(head.toString("ascii", 0, 4), "RIFF", `${file} is not a RIFF file`);
  assert.equal(head.toString("ascii", 8, 12), "WEBP", `${file} is not a WebP`);
  const chunk = head.toString("ascii", 12, 16);
  if (chunk === "VP8X") return [head.readUIntLE(24, 3) + 1, head.readUIntLE(27, 3) + 1];
  if (chunk === "VP8L") {
    const bits = head.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  assert.equal(chunk, "VP8 ", `${file}: unknown WebP chunk "${chunk}"`);
  return [head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff];
}

/**
 * A label's key is its id in camelCase: i18n-keys.test.mjs finds keys by scanning for
 * them written in full, and a key segment cannot hold a hyphen.
 */
const labelKeyFor = (id) => `SDE.encounterMaps.map.${id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/** Whole squares a [x0, y0, x1, y1] px zone holds (the layout only uses whole ones). */
const squaresIn = ([x0, y0, x1, y1]) => Math.floor((x1 - x0) / GRID_PX) * Math.floor((y1 - y0) / GRID_PX);
/** Is zone a inside rect b? */
const inside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const days = ENCOUNTER_MAPS.filter((m) => m.variant === "day");
const camps = ENCOUNTER_MAPS.filter((m) => m.variant === "camp");
const ids = (maps) => maps.map((m) => m.id);
const never = () => { throw new Error("the dice must not be rolled"); };

describe("encounter map library integrity", () => {
  test("ids are unique", () => {
    assert.equal(new Set(ids(ENCOUNTER_MAPS)).size, ENCOUNTER_MAPS.length);
  });

  test("every entry is well-formed", () => {
    for (const m of ENCOUNTER_MAPS) {
      assert.match(m.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id ${m.id} is not a slug`);
      assert.equal(m.labelKey, labelKeyFor(m.id), `labelKey ${m.id}`);
      assert.equal(m.image, `${ASSET_DIR}/${m.id}.webp`, `image ${m.id}`);
      assert.equal(m.thumb, `${ASSET_DIR}/thumbs/${m.id}.webp`, `thumb ${m.id}`);
      assert.ok(["day", "camp"].includes(m.variant), `variant ${m.id}`);
      assert.ok(["built", "pack"].includes(m.kind), `kind ${m.id}`);
      assert.equal(m.grid, GRID_PX, `grid ${m.id}`);
      assert.equal(m.feetPerSquare, FEET_PER_SQUARE, `feetPerSquare ${m.id}`);
      assert.ok(m.terrains.length, `terrains ${m.id}`);
      for (const t of m.terrains) assert.ok(TERRAINS.includes(t), `${m.id}: "${t}" is not a hex terrain`);
    }
  });

  test("every label key is written out whole in the library, which is how the i18n test finds it", () => {
    const source = readFileSync(`${REPO}scripts/encounter/battle-maps/encounter-maps.mjs`, "utf8");
    for (const m of ENCOUNTER_MAPS) assert.ok(source.includes(`"${m.labelKey}"`), `${m.labelKey} is not spelled out`);
  });

  test("every label is a string, and no two maps share one", () => {
    const seen = new Map();
    for (const m of ENCOUNTER_MAPS) {
      const label = STRINGS[m.labelKey];
      assert.ok(label?.length, `${m.labelKey} has no string (languages/en.json)`);
      assert.ok(!seen.has(label), `${m.id} and ${seen.get(label)} are both labelled "${label}"`);
      seen.set(label, m.id);
    }
  });

  test("every picture is a whole number of squares", () => {
    for (const m of ENCOUNTER_MAPS) {
      assert.ok(Number.isInteger(m.width) && Number.isInteger(m.height), `${m.id}: size`);
      assert.equal(m.width % GRID_PX, 0, `${m.id}: width ${m.width} is not a whole number of ${GRID_PX} px squares`);
      assert.equal(m.height % GRID_PX, 0, `${m.id}: height ${m.height} is not a whole number of ${GRID_PX} px squares`);
    }
  });

  /**
   * The zone is where layoutTokens deals the party out, so it has to be on the
   * picture and big enough for a full table, or tokens would spill into the
   * foes' strip or off the map.
   */
  test("the party zone is on the picture and holds six tokens", () => {
    for (const m of ENCOUNTER_MAPS) {
      const [x0, y0, x1, y1] = partyZone(m);
      assert.ok(x0 >= 0 && y0 >= 0 && x1 <= m.width && y1 <= m.height, `${m.id}: zone leaves the picture`);
      assert.ok(x0 < x1 && y0 < y1, `${m.id}: zone is inside out`);
      assert.ok(squaresIn([x0, y0, x1, y1]) >= 6, `${m.id}: zone holds only ${squaresIn([x0, y0, x1, y1])} whole squares`);
    }
  });

  test("a camp fire is on the picture, inside the party's zone, and only a camp has one", () => {
    for (const m of ENCOUNTER_MAPS) {
      if (m.variant === "day") {
        assert.equal(m.campLight, undefined, `${m.id}: a day map has no camp fire`);
        continue;
      }
      const { x, y } = m.campLight;
      const [x0, y0, x1, y1] = partyZone(m);
      assert.ok(x >= 0 && x <= m.width && y >= 0 && y <= m.height, `${m.id}: fire is off the picture`);
      assert.ok(x >= x0 && x <= x1 && y >= y0 && y <= y1, `${m.id}: the party starts away from its own fire`);
    }
  });

  test("every image file exists on disk and is the size the library says", () => {
    for (const m of ENCOUNTER_MAPS) {
      const file = fileOf(m);
      assert.ok(existsSync(file), `file ${m.id} (${m.image}): run tools/encounter-maps/build-assets.py`);
      assert.deepEqual(webpSize(file), [m.width, m.height], `${m.id}: the file is not ${m.width}x${m.height}`);
    }
  });

  /**
   * The picker lists many maps at once and draws a preview for each, so the
   * previews have to be small in bytes and in pixels, and be the same picture:
   * a preview of the wrong shape would stretch.
   */
  test("every preview exists, is 480 px on its long side in the picture's shape, and is small", () => {
    let total = 0;
    for (const m of ENCOUNTER_MAPS) {
      const file = thumbOf(m);
      assert.ok(existsSync(file), `preview ${m.id} (${m.thumb}): run tools/encounter-maps/build-assets.py`);
      const [w, h] = webpSize(file);
      const k = THUMB_LONG_SIDE / Math.max(m.width, m.height);
      assert.equal(Math.max(w, h), THUMB_LONG_SIDE, `${m.id}: the preview is ${w}x${h}`);
      assert.ok(Math.abs(w - m.width * k) <= 1 && Math.abs(h - m.height * k) <= 1,
        `${m.id}: a ${w}x${h} preview is not the shape of a ${m.width}x${m.height} picture`);
      const bytes = statSync(file).size;
      assert.ok(bytes < 150 * 1024, `${m.id}: the preview is ${Math.round(bytes / 1024)} KB`);
      total += bytes;
    }
    assert.ok(total < 3 * 1024 * 1024, `the previews add up to ${(total / 1024 / 1024).toFixed(1)} MB`);
  });

  /**
   * A map that was dropped, or renamed, must not leave its picture behind: the
   * folder ships whole, so a stray file is shipped weight and credit-less art.
   */
  test("the folders hold the library's pictures and previews and nothing else", () => {
    const wanted = new Set(ENCOUNTER_MAPS.map((m) => `${m.id}.webp`));
    const root = onDisk(ASSET_DIR);
    const stray = [
      ...readdirSync(root).filter((f) => f !== "thumbs" && !wanted.has(f)),
      ...readdirSync(`${root}/thumbs`).filter((f) => !wanted.has(f)).map((f) => `thumbs/${f}`),
    ];
    assert.deepEqual(stray, [], `not in the library, delete them from ${ASSET_DIR}: ${stray.join(", ")}`);
  });
});

describe("camp variants", () => {
  test("a camp is the camp of a real day map, same size and terrains, and each day map has at most one", () => {
    const claimed = new Set();
    for (const c of camps) {
      const day = getEncounterMap(c.variantOf);
      assert.equal(day?.variant, "day", `${c.id}: variantOf "${c.variantOf}" is not a day map`);
      assert.deepEqual(c.terrains, day.terrains, `${c.id}: terrains differ from ${day.id}`);
      assert.equal(c.width, day.width, `${c.id}: width`);
      assert.equal(c.height, day.height, `${c.id}: height`);
      assert.ok(!claimed.has(day.id), `${day.id} has two camps`);
      claimed.add(day.id);
    }
    for (const m of days) assert.equal(m.variantOf, undefined, `${m.id}: a day map is no-one's camp`);
  });

  test("a camp credits what its day map credits, and the Camp Tokens", () => {
    for (const c of camps) {
      const day = getEncounterMap(c.variantOf);
      for (const s of day.sources) assert.ok(c.sources.some((x) => x.url === s.url), `${c.id} lacks ${s.name}`);
      assert.ok(c.sources.some((s) => s.name === "Camp Tokens"), `${c.id} lacks the Camp Tokens`);
    }
  });

  test("a map on the water has no camp: the boat is the camp", () => {
    for (const m of days.filter((x) => x.boat)) assert.equal(campVariantOf(m), null, m.id);
  });

  test("campVariantOf finds a day map's camp and nothing else", () => {
    assert.equal(campVariantOf(getEncounterMap("forest-woods"))?.id, "forest-woods-camp");
    assert.equal(campVariantOf(getEncounterMap("forest-edge-of-the-woods")), null);
    assert.equal(campVariantOf(getEncounterMap("forest-woods-camp")), null);
    assert.equal(campVariantOf(null), null);
  });
});

describe("boats", () => {
  test("only water terrains have a boat, and every one of them starts in one", () => {
    for (const m of ENCOUNTER_MAPS.filter((x) => x.boat)) {
      assert.ok(m.terrains.every((t) => WATER_TERRAINS.includes(t)), `${m.id}: a boat on dry land`);
      assert.ok(m.party, `${m.id}: a boat map needs the deck as its party zone`);
    }
    for (const m of ENCOUNTER_MAPS.filter((x) => x.terrains.some((t) => WATER_TERRAINS.includes(t)))) {
      assert.ok(m.boat, `${m.id}: the party is on the water, so it needs a boat`);
    }
    for (const t of WATER_TERRAINS) assert.ok(mapsForTerrain(t)[0]?.boat, `${t} must open on a boat`);
  });
});

/**
 * WHERE TOKENS START. The party starts on dry ground or a boat's deck, never in a
 * pool, a lagoon, lava or a chasm, and node cannot read a picture, so the survey is
 * the check: each map's zones are pinned to ground that was read off the art.
 *
 * GROUND holds, per map with a zone of its own, rectangles of ground. They are the
 * maximal rectangles in which every 100 px square is under about a quarter hazard
 * by a colour test made for that map (water, lava or "not hull"), found by
 * program and then looked at with the zone and the first eight token squares drawn
 * on top. Two are weaker: the stone bridge's two ends were read by eye (rock
 * against mist is no colour test), and the foes' island on the lava map is a 3x4
 * oval whose rim squares are about a third lava.
 *
 * CENTRAL lists the maps whose party zone is the default, the central 30% of the
 * picture, which was looked at on each of them. A map on neither list has not been
 * surveyed, and a change to the default share fails every map on CENTRAL, so it
 * cannot move the party into a pool unseen.
 *
 * This would have caught swamp-bog's shared open patch reaching into its pools, and
 * the lagoon and tidal channel that were the middle of two pack maps. The party
 * packs against the edge of its zone that faces the foes, so one bad edge puts every
 * PC in the water at once.
 */
const LAND = [[1250, 900, 2750, 2100]];   // the open patch the built land scenes were composed around
const CAMP = [[1400, 1100, 2600, 1900]];  // the camp, round its fire
const GROUND = {
  "forest-woods": LAND,
  "forest-road": LAND,                    // the dirt road crosses it
  "grassland-open": LAND,
  "jungle-dense": LAND,
  "desert-dunes": LAND,
  "salt-flat": LAND,
  "swamp-bog": [[700, 1500, 2400, 2100]],                // dry ground between the pools; the shared patch is half pool
  "river-rowboat": [[1900, 700, 2400, 900]],             // the boats: the stretch where every square is deck
  "lake-calm": [[1700, 1400, 2300, 1600]],
  "ocean-open-sea": [[1100, 1300, 2500, 1700]],
  "arctic-sea-ice-floes": [[1500, 1400, 2400, 1600]],
  "forest-woods-camp": CAMP,
  "forest-road-camp": [[1300, 1700, 2700, 2600]],        // below the road
  "grassland-open-camp": CAMP,
  "jungle-dense-camp": CAMP,
  "swamp-bog-camp": [[700, 1500, 2400, 1900]],           // the fire stands on the pools' south rim
  "desert-dunes-camp": CAMP,
  "salt-flat-camp": CAMP,
  "swamp-swamp-trail": [[1700, 400, 2900, 1500]],        // the big mound below the sinkhole
  "canyon-natural-stone-bridge": [[100, 600, 1000, 1300], [2300, 750, 3100, 1350]],  // the arch's west end, the platform at its east end
  "coast-rocky-coast": [[200, 800, 700, 1600]],          // the sandy bank
  "coast-driftwood-cove": [[600, 300, 4200, 1100]],      // the sand strip north of the lagoon
  "volcano-rock-pools-lava": [[1000, 600, 1400, 1000]],  // the rock platform
  "volcano-scattered-islands": [[500, 700, 800, 900], [1200, 300, 1500, 700]],  // the party's island, the foes' island
  "tunnels-jagged-cave": [[800, 800, 1400, 1200]],
  "tunnels-pooling-caverns": [[2100, 1200, 3100, 1700]],
};
const CENTRAL = [
  "forest-edge-of-the-woods", "path-wildroad", "path-roadside-wilderness", "path-cobblestone-highway",
  "forest-bandit-ambush", "forest-camp", "grassland-green-hill", "grassland-meadow-picnic",
  "grassland-farmers-fields", "swamp-haunted-marsh", "desert-rocky-desert", "mountain-highland-pass",
  "canyon-prehistoric-creek", "canyon-rocky-fissures", "coast-beach-dunes", "coast-crab-rock",
  "tunnels-luminescent-cave",
];
/** The central 30% as the survey saw it: written out here, not read from the library, so changing the library's share shows up. */
const central30 = (m) => [Math.round(m.width * 0.35), Math.round(m.height * 0.35), Math.round(m.width * 0.65), Math.round(m.height * 0.65)];

describe("where tokens start", () => {
  test("every map has had the ground under its party zone surveyed", () => {
    for (const m of ENCOUNTER_MAPS) {
      assert.ok(GROUND[m.id] || CENTRAL.includes(m.id), `${m.id}: look at the art under its party zone and add it to GROUND or CENTRAL`);
      assert.ok(!(GROUND[m.id] && CENTRAL.includes(m.id)), `${m.id} is on both lists`);
    }
    for (const id of [...Object.keys(GROUND), ...CENTRAL]) assert.ok(getEncounterMap(id), `${id} is surveyed but is not a map`);
    for (const [id, rects] of Object.entries(GROUND)) {
      const m = getEncounterMap(id);
      for (const r of rects) assert.ok(inside(r, [0, 0, m.width, m.height]), `${id}: surveyed ground ${r} leaves the picture`);
    }
  });

  test("every party zone and foes zone lies inside ground", () => {
    for (const [id, rects] of Object.entries(GROUND)) {
      const m = getEncounterMap(id);
      const zones = { party: partyZone(m), ...(m.foes ? { foes: m.foes } : {}) };
      for (const [name, zone] of Object.entries(zones)) {
        assert.ok(rects.some((r) => inside(zone, r)), `${id}: the ${name} zone [${zone}] is not inside the ground surveyed for it`);
      }
    }
  });

  test("a map left on the default zone is still on the central 30% that was looked at", () => {
    for (const id of CENTRAL) {
      const m = getEncounterMap(id);
      assert.equal(m.party, undefined, `${id}: it has a zone of its own now, so survey it in GROUND`);
      assert.deepEqual(partyZone(m), central30(m), `${id}: the default zone is no longer the central 30% that was surveyed`);
    }
  });

  test("a map whose art is no place to start is not in the library", () => {
    // Jungle Wetland is a lily pond with a canoe 1.4 x 4.8 squares: no dry ground, no deck for a party.
    assert.equal(getEncounterMap("jungle-jungle-wetland"), null);
    assert.ok(!mapsForTerrain("jungle").some((m) => m.id.includes("wetland")));
    assert.ok(!mapsForTerrain("swamp").some((m) => m.id.includes("wetland")));
  });

  describe("the foes' zone", () => {
    const withFoes = ENCOUNTER_MAPS.filter((m) => m.foes);

    test("the two maps whose middle is a hazard set one, and no other map does", () => {
      assert.deepEqual(withFoes.map((m) => m.id).sort(), ["canyon-natural-stone-bridge", "volcano-scattered-islands"]);
    });

    test("it is on the picture, holds a group, and is not the party's ground", () => {
      for (const m of withFoes) {
        const [x0, y0, x1, y1] = m.foes;
        assert.equal(m.foes.length, 4, `${m.id}: foes is [x0, y0, x1, y1]`);
        assert.ok(x0 >= 0 && y0 >= 0 && x1 <= m.width && y1 <= m.height && x0 < x1 && y0 < y1, `${m.id}: foes zone is off the picture`);
        assert.ok(squaresIn(m.foes) >= 8, `${m.id}: foes zone holds only ${squaresIn(m.foes)} whole squares`);
        assert.ok(!overlap(m.foes, partyZone(m)), `${m.id}: the foes would start among the party`);
      }
    });
  });
});

describe("credits", () => {
  test("every map credits the products it is made from, and CREDITS.md repeats each one", () => {
    const named = new Map();
    for (const m of ENCOUNTER_MAPS) {
      assert.ok(m.sources.length, `${m.id}: no sources`);
      assert.equal(new Set(m.sources.map((s) => s.url)).size, m.sources.length, `${m.id}: a source twice`);
      if (m.kind === "pack") assert.equal(m.sources.length, 1, `${m.id}: a pack map is one product`);
      for (const s of m.sources) {
        assert.match(s.url, /^https:\/\/2minutetabletop\.com\/product\/[a-z0-9-]+\/$/, `${m.id}: ${s.url}`);
        assert.ok(s.name.length, `${m.id}: unnamed source`);
        assert.equal(named.get(s.url) ?? s.name, s.name, `${s.url} is named two ways`);
        named.set(s.url, s.name);
        assert.ok(CREDITS.includes(`[${s.name}](${s.url})`), `CREDITS.md does not credit [${s.name}](${s.url}) (${m.id})`);
      }
    }
  });
});

describe("the library's order", () => {
  test("built maps lead and the packs' own maps follow", () => {
    const firstPack = ENCOUNTER_MAPS.findIndex((m) => m.kind === "pack");
    assert.ok(firstPack > 0);
    assert.ok(ENCOUNTER_MAPS.slice(0, firstPack).every((m) => m.kind === "built"));
    assert.ok(ENCOUNTER_MAPS.slice(firstPack).every((m) => m.kind === "pack"));
  });

  test("every terrain has a day map, and a terrain with a built one opens on it", () => {
    for (const t of TERRAINS) {
      const maps = mapsForTerrain(t);
      assert.ok(maps.length, `terrain ${t} has no map`);
      if (maps.some((m) => m.kind === "built")) assert.equal(maps[0].kind, "built", `${t} should open on its built map`);
    }
  });

  test("mapsForTerrain returns day maps only, in library order", () => {
    for (const t of TERRAINS) {
      const maps = mapsForTerrain(t);
      assert.ok(maps.every((m) => m.variant === "day" && m.terrains.includes(t)), t);
      const order = maps.map((m) => ENCOUNTER_MAPS.indexOf(m));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${t} is out of library order`);
    }
  });
});

describe("lookups", () => {
  test("getEncounterMap finds a day map and a camp, and rejects an unknown id", () => {
    assert.equal(getEncounterMap("forest-woods")?.variant, "day");
    assert.equal(getEncounterMap("forest-woods-camp")?.variant, "camp");
    assert.equal(getEncounterMap("no-such-map"), null);
    assert.equal(getEncounterMap(undefined), null);
  });

  test("a terrain's maps and the other maps are every day map, once", () => {
    for (const t of [...TERRAINS, "a terrain a GM typed"]) {
      const mine = ids(mapsForTerrain(t));
      const rest = ids(otherMaps(t));
      assert.equal(mine.filter((id) => rest.includes(id)).length, 0, `${t}: a map is in both lists`);
      assert.equal(mine.length + rest.length, days.length, `${t}: a day map is in neither list`);
    }
    assert.equal(mapsForTerrain("a terrain a GM typed").length, 0);
  });
});

describe("normalizePrefs", () => {
  test("anything that is not an object of choices gives none", () => {
    for (const junk of [undefined, null, 0, 7, "forest", true, [], () => {}]) {
      assert.deepEqual(normalizePrefs(junk), {}, String(junk));
    }
  });

  test("keeps a pin and the disabled list, and drops the junk inside them", () => {
    const out = normalizePrefs({
      forest: { pinned: "forest-edge-of-the-woods", disabled: ["forest-camp", "forest-camp", "no-such-map", 7, null, "forest-woods-camp"] },
      swamp: { pinned: 7, disabled: "everything" },
      path: "forest-road",
      lake: [],
      narnia: { pinned: "forest-woods", disabled: [] },
    });
    assert.deepEqual(out, {
      forest: { pinned: "forest-edge-of-the-woods", disabled: ["forest-camp"] },
      swamp: { pinned: null, disabled: [] },
    });
  });

  test("is idempotent and leaves its input alone", () => {
    const raw = { forest: { pinned: "forest-woods", disabled: ["forest-camp"] } };
    const copy = structuredClone(raw);
    const once = normalizePrefs(raw);
    assert.deepEqual(raw, copy);
    assert.deepEqual(normalizePrefs(once), once);
    assert.notEqual(once.forest, raw.forest);
  });
});

describe("enabledMapsFor and resolveDefaultMap", () => {
  const forest = mapsForTerrain("forest");

  test("a terrain nobody touched has every map enabled", () => {
    assert.deepEqual(ids(enabledMapsFor("forest", {})), ids(forest));
    assert.deepEqual(ids(enabledMapsFor("forest", undefined)), ids(forest));
  });

  test("disabling takes a map out, keeps the order, and ignores another terrain's maps", () => {
    const prefs = { forest: { pinned: null, disabled: [forest[1].id, "lake-calm"] } };
    assert.deepEqual(ids(enabledMapsFor("forest", prefs)), [forest[0].id, forest[2].id, forest[3].id]);
  });

  test("an untouched terrain opens the library's first map, without rolling", () => {
    assert.equal(resolveDefaultMap("forest", {}, { rng: never }), forest[0]);
    assert.equal(resolveDefaultMap("forest", undefined, { rng: never }), forest[0]);
    assert.equal(resolveDefaultMap("lake", normalizePrefs(null), { rng: never }), mapsForTerrain("lake")[0]);
  });

  test("a pin that is enabled wins, without rolling", () => {
    const prefs = { forest: { pinned: forest[2].id, disabled: [] } };
    assert.equal(resolveDefaultMap("forest", prefs, { rng: never }), forest[2]);
  });

  test("a saved entry with no pin is random among the enabled maps, by the dice", () => {
    const prefs = { forest: { pinned: null, disabled: [forest[0].id] } };
    assert.equal(resolveDefaultMap("forest", prefs, { rng: () => 0 }), forest[1]);
    assert.equal(resolveDefaultMap("forest", prefs, { rng: () => 0.5 }), forest[2]);
    assert.equal(resolveDefaultMap("forest", prefs, { rng: () => 0.999 }), forest[3]);
    // The real dice only ever land on an enabled map.
    for (let i = 0; i < 50; i++) assert.notEqual(resolveDefaultMap("forest", prefs).id, forest[0].id);
  });

  test("a pin that was disabled is ignored, and the others are rolled for", () => {
    const prefs = { forest: { pinned: forest[1].id, disabled: [forest[1].id] } };
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const got = resolveDefaultMap("forest", prefs, { rng: () => roll });
      assert.ok(got && got !== forest[1], `roll ${roll} gave ${got?.id}`);
    }
  });

  test("a pin on a map made for another terrain is not honoured", () => {
    const prefs = normalizePrefs({ forest: { pinned: "lake-calm", disabled: [] } });
    assert.equal(prefs.forest.pinned, "lake-calm");
    assert.equal(resolveDefaultMap("forest", prefs, { rng: () => 0 }), forest[0]);
  });

  test("every map disabled gives none, and the other maps are still there for the picker", () => {
    const prefs = { forest: { pinned: forest[0].id, disabled: ids(forest) } };
    assert.deepEqual(enabledMapsFor("forest", prefs), []);
    assert.equal(resolveDefaultMap("forest", prefs, { rng: never }), null);
    assert.equal(resolveDefaultMap("a terrain a GM typed", {}, { rng: never }), null);
    assert.ok(otherMaps("forest").length > 0);
  });
});

describe("pickVariant", () => {
  const woods = getEncounterMap("forest-woods");

  test("a camp is chosen when asked for, and only when the map has one", () => {
    assert.deepEqual(pickVariant(woods, { camping: true }).map, getEncounterMap("forest-woods-camp"));
    assert.equal(pickVariant(woods, { camping: true }).camp, true);
    assert.equal(pickVariant(woods).map, woods);
    assert.equal(pickVariant(woods, { camping: false }).camp, false);
    for (const id of ["lake-calm", "river-rowboat", "forest-edge-of-the-woods"]) {
      const map = getEncounterMap(id);
      assert.deepEqual(pickVariant(map, { camping: true }), { map, darkness: 0, camp: false }, id);
    }
  });

  test("night is scene darkness, whatever the art", () => {
    assert.equal(pickVariant(woods).darkness, 0);
    assert.equal(pickVariant(woods, { night: false }).darkness, 0);
    assert.equal(pickVariant(woods, { night: true }).darkness, NIGHT_DARKNESS);
    assert.deepEqual(
      pickVariant(woods, { night: true, camping: true }),
      { map: getEncounterMap("forest-woods-camp"), darkness: NIGHT_DARKNESS, camp: true },
    );
  });

  test("either variant in gives the same answer out", () => {
    const camp = getEncounterMap("forest-woods-camp");
    for (const opts of [{}, { camping: true }, { night: true }, { night: true, camping: true }]) {
      assert.deepEqual(pickVariant(camp, opts), pickVariant(woods, opts), JSON.stringify(opts));
    }
  });
});

describe("partyZone", () => {
  test("a map with no zone of its own starts the party in the central 30% of it", () => {
    const edge = getEncounterMap("forest-edge-of-the-woods");
    assert.equal(edge.party, undefined);
    assert.deepEqual(partyZone(edge), [770, 560, 1430, 1040]);
    for (const m of ENCOUNTER_MAPS.filter((x) => !x.party)) {
      const [x0, y0, x1, y1] = partyZone(m);
      assert.ok(Math.abs((x1 - x0) - m.width * 0.3) <= 1, `${m.id}: width of the zone`);
      assert.ok(Math.abs((y1 - y0) - m.height * 0.3) <= 1, `${m.id}: height of the zone`);
      assert.ok(Math.abs(x0 + x1 - m.width) <= 1 && Math.abs(y0 + y1 - m.height) <= 1, `${m.id}: not centred`);
    }
  });

  test("a map's own zone is returned as a copy, so a caller cannot move the library's", () => {
    const woods = getEncounterMap("forest-woods");
    const zone = partyZone(woods);
    assert.deepEqual(zone, woods.party);
    zone[0] = -1;
    assert.notEqual(woods.party[0], -1);
    assert.deepEqual(partyZone(woods), woods.party);
  });
});
