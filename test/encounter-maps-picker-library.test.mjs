/**
 * The picker against the real map library (scripts/encounter/battle-maps/encounter-maps.mjs).
 *
 * The picker marks a default and the Battle map button opens one, and the two
 * must be the same map. They are worked out in two places (the library's
 * resolveDefaultMap, and the picker core's defaultRule), so this holds them
 * together over every state the saved choices can be in, for every terrain the
 * library has maps for, and then checks that what the picker writes is read back
 * by the library as the choice the GM made.
 *
 * Unlike encounter-maps-picker-core.test.mjs this reads the library's real data,
 * so it is the one that notices if the two parts drift apart.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TERRAINS } from "../scripts/encounter/battle-maps/constants.mjs";
import {
  ENCOUNTER_MAPS, campVariantOf, getEncounterMap, mapsForTerrain, normalizePrefs, otherMaps, resolveDefaultMap,
} from "../scripts/encounter/battle-maps/encounter-maps.mjs";
import {
  TERRAIN_LABEL_KEYS, defaultRule, imageSrc, pickerModel, savedEntry, thumbSrc, withEnabled, withPinned, withRandom,
} from "../scripts/encounter/battle-maps/battle-map-picker-core.mjs";

const dayMaps = ENCOUNTER_MAPS.filter((m) => m.variant === "day");
const grounds = TERRAINS.filter((t) => mapsForTerrain(t).length);

/** Every state the saved choices can be in for a terrain: nothing saved, random, or a pin, each with any maps off. */
function statesFor(terrain) {
  const ids = mapsForTerrain(terrain).map((m) => m.id);
  const subsets = ids.reduce((all, id) => [...all, ...all.map((s) => [...s, id])], [[]]);
  return [
    {},
    ...subsets.flatMap((disabled) => [
      { [terrain]: { pinned: null, disabled } },
      ...ids.filter((id) => !disabled.includes(id)).map((pinned) => ({ [terrain]: { pinned, disabled } })),
    ]),
  ];
}

/** What the library says the button opens, for the two ends of the dice and every face between. */
function libraryAnswers(terrain, prefs, enabledCount) {
  const stored = normalizePrefs(prefs);
  const at = (roll) => resolveDefaultMap(terrain, stored, { rng: () => roll })?.id ?? null;
  const faces = Array.from({ length: enabledCount }, (_, i) => at((i + 0.5) / enabledCount));
  return { low: at(0), high: at(0.999999), faces };
}

describe("the picker and the library agree on the default", () => {
  test("the library has maps for most terrains, and the picker names every ground it uses", () => {
    assert.ok(grounds.length >= 10, `${grounds.length} terrains have maps`);
    for (const m of dayMaps) for (const t of m.terrains) assert.ok(t in TERRAIN_LABEL_KEYS, `${m.id}: ${t} has no name`);
  });

  test("for every terrain, the lists the picker is given cover each day map exactly once", () => {
    for (const t of TERRAINS) {
      const listed = [...mapsForTerrain(t), ...otherMaps(t)].map((m) => m.id);
      assert.deepEqual([...listed].sort(), dayMaps.map((m) => m.id).sort(), t);
    }
  });

  test("the rule is the library's, for every state of the saved choices", () => {
    let checked = 0;
    for (const terrain of grounds) {
      const maps = mapsForTerrain(terrain);
      for (const prefs of statesFor(terrain)) {
        const saved = savedEntry(prefs, terrain);
        const rule = defaultRule(maps, saved);
        const enabled = maps.filter((m) => !saved?.disabled.includes(m.id));
        const lib = libraryAnswers(terrain, prefs, enabled.length);
        const label = `${terrain} ${JSON.stringify(prefs)}`;
        if (rule.mode === "none") {
          assert.deepEqual([lib.low, lib.high], [null, null], label);
        } else if (rule.mode === "random") {
          // Random is a uniform draw over exactly the maps that are on, and never a fixed one.
          assert.deepEqual(lib.faces, enabled.map((m) => m.id), label);
          assert.equal(rule.map, null, label);
        } else {
          // Default and pinned both name one map, whatever the dice say.
          assert.deepEqual([lib.low, lib.high, ...lib.faces], Array(2 + enabled.length).fill(rule.map.id), label);
        }
        checked++;
      }
    }
    assert.ok(checked > 100, `checked ${checked} states`);
  });

  test("the picker's model marks the same default, and shows random as random", () => {
    for (const terrain of grounds) {
      const maps = mapsForTerrain(terrain);
      for (const prefs of statesFor(terrain)) {
        const model = pickerModel({ terrain, maps, otherMaps: otherMaps(terrain), prefs, campOf: campVariantOf, canEdit: true });
        const section = model.sections[0];
        const lib = libraryAnswers(terrain, prefs, maps.length);
        const label = `${terrain} ${JSON.stringify(prefs)}`;
        assert.deepEqual(section.cards.filter((c) => c.isDefault).map((c) => c.id), section.defaultId ? [section.defaultId] : [], label);
        if (section.mode === "random") {
          assert.equal(section.defaultId, null, label);
          assert.ok(section.cards.every((c) => !c.isDefault && c.isRandom === c.enabled), label);
        } else if (section.mode !== "none") {
          assert.equal(section.defaultId, lib.low, label);
          assert.equal(section.defaultId, lib.high, label);
        }
        assert.equal(model.selected?.mapId ?? null, section.defaultId, "the picker starts on the default");
      }
    }
  });
});

describe("what the picker writes, the library reads back as the choice the GM made", () => {
  test("switching a map off or on never turns a default the GM can see into random", () => {
    let checked = 0;
    for (const terrain of grounds) {
      const maps = mapsForTerrain(terrain);
      for (const prefs of statesFor(terrain)) {
        const before = defaultRule(maps, savedEntry(prefs, terrain));
        if (before.mode !== "default" && before.mode !== "pinned") continue;
        for (const map of maps) {
          for (const enabled of [false, true]) {
            const after = withEnabled(prefs, terrain, maps, map.id, enabled);
            const left = maps.filter((m) => !savedEntry(after, terrain).disabled.includes(m.id));
            const lib = libraryAnswers(terrain, after, left.length);
            // The same map as before, unless it was the one switched off: then the first map still on.
            const want = !left.length ? null : !enabled && before.map.id === map.id ? left[0].id : before.map.id;
            assert.deepEqual([lib.low, lib.high], [want, want], `${terrain} ${JSON.stringify(prefs)} ${enabled ? "on" : "off"} ${map.id}`);
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 100, `checked ${checked} switches`);
  });

  test("a pin the GM sets is the one the button opens, and Pick at random is a draw over the maps that are on", () => {
    for (const terrain of grounds) {
      const maps = mapsForTerrain(terrain);
      for (const prefs of statesFor(terrain)) {
        for (const map of maps) {
          const pinned = withPinned(prefs, terrain, map.id);
          assert.equal(libraryAnswers(terrain, pinned, 1).low, map.id, `${terrain} pin ${map.id}`);
          assert.equal(libraryAnswers(terrain, pinned, 1).high, map.id);
        }
        const random = withRandom(prefs, terrain, maps, true);
        const on = maps.filter((m) => !savedEntry(random, terrain).disabled.includes(m.id));
        assert.deepEqual(libraryAnswers(terrain, random, on.length).faces, on.map((m) => m.id), `${terrain} random`);
      }
    }
  });

  test("turning a map back on after every map was off pins it, and the library opens it: random is only ever asked for", () => {
    let checked = 0;
    for (const terrain of grounds) {
      const maps = mapsForTerrain(terrain);
      let off = {};
      for (const m of maps) off = withEnabled(off, terrain, maps, m.id, false);
      assert.equal(defaultRule(maps, savedEntry(off, terrain)).mode, "none", terrain);
      for (const map of maps) {
        const back = withEnabled(off, terrain, maps, map.id, true);
        const lib = libraryAnswers(terrain, back, 1);
        assert.deepEqual([lib.low, lib.high], [map.id, map.id], `${terrain} ${map.id}`);
        // One map on is one map to draw, random or not. A second coming back tells them apart: it leaves the first
        // as the default, where random would draw between the two.
        const other = maps.find((m) => m !== map);
        if (other) {
          const both = libraryAnswers(terrain, withEnabled(back, terrain, maps, other.id, true), 2);
          assert.deepEqual([both.low, both.high, ...both.faces], Array(4).fill(map.id), `${terrain} ${map.id} then ${other.id}`);
        }
        checked++;
      }
    }
    assert.ok(checked > 20, `checked ${checked} maps`);
  });

  test("stopping random gives the library a fixed default again, the first map that is on", () => {
    for (const terrain of grounds) {
      const maps = mapsForTerrain(terrain);
      for (const prefs of statesFor(terrain)) {
        if (defaultRule(maps, savedEntry(prefs, terrain)).mode !== "random") continue;
        const after = withRandom(prefs, terrain, maps, false);
        const on = maps.filter((m) => !savedEntry(after, terrain).disabled.includes(m.id));
        const lib = libraryAnswers(terrain, after, on.length);
        assert.deepEqual([lib.low, lib.high], [on[0].id, on[0].id], `${terrain} ${JSON.stringify(prefs)}`);
      }
    }
  });
});

describe("what the picker draws", () => {
  const cardsFor = (terrain, camping) => {
    const model = pickerModel({ terrain, maps: mapsForTerrain(terrain), otherMaps: otherMaps(terrain), camping, campOf: campVariantOf });
    return [...model.sections[0].cards, ...model.sections[1].cards];
  };

  test("a card draws the library's thumbnail, and its full-size art only when the entry has no thumbnail", () => {
    for (const terrain of grounds) {
      for (const card of cardsFor(terrain, false)) {
        const map = getEncounterMap(card.id);
        assert.equal(card.thumb, thumbSrc(map), `${terrain} ${card.id}`);
        if (map.thumb) assert.notEqual(card.thumb, imageSrc(map), `${card.id} draws its full-size art although it has a thumbnail`);
      }
    }
  });

  test("with Camp on, the camp art a card shows is the camp's thumbnail too", () => {
    for (const card of cardsFor("forest", true)) {
      const camp = campVariantOf(getEncounterMap(card.id));
      assert.equal(card.thumb, thumbSrc(camp ?? getEncounterMap(card.id)), card.id);
      if (camp?.thumb) assert.notEqual(card.thumb, imageSrc(camp), `${card.id}: the camp's full-size art`);
    }
  });

  test("the library gives thumbnails to every map or to none, so no card quietly draws the big picture", () => {
    const withThumb = ENCOUNTER_MAPS.filter((m) => m.thumb);
    assert.ok(withThumb.length === 0 || withThumb.length === ENCOUNTER_MAPS.length,
      `${ENCOUNTER_MAPS.filter((m) => !m.thumb).map((m) => m.id).join(", ")} have no thumbnail`);
  });
});
