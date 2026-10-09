/**
 * The encounter scene builder and the battle lifecycle, against a small stand-in for Foundry.
 *
 * What the fakes keep faithful is what these flows depend on, each of it read from the v14 source:
 *  - a scene's flags change only through an update that carries a `_replace` operator (anything else would merge, or
 *    with recursive:false wipe the module's other flags);
 *  - `createEmbeddedDocuments`, `update` and `Combat.create` can throw AFTER they applied (v14 runs _onUpdate/_onCreate
 *    outside a try) or resolve having done nothing (a hook's veto);
 *  - a token batch delete is strict: an id the scene does not have throws and deletes nothing, and a preDeleteToken hook
 *    can veto single tokens, which then just stay;
 *  - Combat._onDeleteTokens compares the combat's scene (a document) with an id, so deleting a token does NOT take its
 *    combatant out of a combat tied to a scene: the fakes leave the combatants where they are;
 *  - `TokenDocument.createCombatants` adds to the viewed combat unless it is handed one;
 *  - a token cloned into another parent keeps its flags and takes what it is given, flags merged;
 *  - a scene's origin on the canvas is its padding minus the background's shift, and its grid answers
 *    getTopLeftPoint for the cell that holds a point.
 * What they cannot show is Foundry itself: that is for a live world.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BattleMaps, _canvasSpot, _deps, resumeBattleReadout } from "../scripts/encounter/battle-maps/encounter-battle.mjs";
import {
  copyAsSaved, encounterSceneName, ensureEncounterScene, findEncounterScene,
} from "../scripts/encounter/battle-maps/encounter-scene.mjs";
import { ENCOUNTER_MAPS, getEncounterMap } from "../scripts/encounter/battle-maps/encounter-maps.mjs";
import { FLAGS, FOLDERS, NIGHT_DARKNESS, SETTINGS } from "../scripts/encounter/battle-maps/constants.mjs";

const MOD = "shadowdark-enhancer";
const REAL_DEPS = { ..._deps };

class Replacement { constructor(value) { this.value = value; } }

// ─── the stand-in world ──────────────────────────────────────────────────────

let seq = 0;
const nextId = (prefix) => `${prefix}${String(++seq).padStart(6, "0")}`;

const collection = (items) => ({
  contents: items,
  get: (id) => items.find((i) => i.id === id),
  has: (id) => items.some((i) => i.id === id),
  find: (fn) => items.find(fn),
  getName: (name) => items.find((i) => i.name === name),
  map: (fn) => items.map(fn),
  [Symbol.iterator]: () => items.values(),
});

const setPath = (obj, path, value) => {
  const parts = path.split(".");
  const last = parts.pop();
  let node = obj;
  for (const part of parts) node = node[part] ??= {};
  node[last] = value;
};

const deepMerge = (target, source) => {
  const out = structuredClone(target ?? {});
  for (const [k, v] of Object.entries(source ?? {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
};

// The folders' names are in the GM's language; the English ones are what an earlier version made.
const STRINGS = {
  "SDE.encounterMaps.scene.prefix": "Encounter:",
  "SDE.encounterMaps.folder.maps": "Mapas de encuentro",
  "SDE.encounterMaps.folder.saved": "Encuentros guardados",
  "SDE.encounterMaps.map.fake-grove": "Fake grove",
  "SDE.encounterMaps.map.fake-grove-camp": "Fake grove (camp)",
  "SDE.encounterMaps.map.fake-lake": "Fake lake",
  "SDE.encounterMaps.map.fake-isles": "Fake isles",
};

const GROVE = {
  id: "fake-grove", labelKey: "SDE.encounterMaps.map.fake-grove", terrains: ["forest"], variant: "day", kind: "built",
  image: `modules/${MOD}/assets/scenes/encounter/fake-grove.webp`, width: 4000, height: 3000, grid: 100, feetPerSquare: 5,
  party: [1250, 900, 2750, 2100],
};
const GROVE_CAMP = {
  ...GROVE, id: "fake-grove-camp", labelKey: "SDE.encounterMaps.map.fake-grove-camp", variant: "camp", variantOf: "fake-grove",
  party: [1400, 1100, 2600, 1900], campLight: { x: 2000, y: 1500 },
};
// a small water map: the party zone is the boat's deck, 4400x1600
const LAKE = {
  id: "fake-lake", labelKey: "SDE.encounterMaps.map.fake-lake", terrains: ["lake"], variant: "day", kind: "built", boat: true,
  image: `modules/${MOD}/assets/scenes/encounter/fake-lake.webp`, width: 4400, height: 1600, grid: 100, feetPerSquare: 5,
  party: [1700, 740, 2700, 900],
};
// a hazard map: the party on one island, the foes on another, a chasm between (the map names where its foes go)
const ISLES = {
  id: "fake-isles", labelKey: "SDE.encounterMaps.map.fake-isles", terrains: ["volcano"], variant: "day", kind: "pack",
  image: `modules/${MOD}/assets/scenes/encounter/fake-isles.webp`, width: 2200, height: 1600, grid: 100, feetPerSquare: 5,
  party: [500, 600, 800, 1000], foes: [1500, 400, 1900, 1200],
};
const MAPS = [GROVE, GROVE_CAMP, LAKE, ISLES];

/** Just enough of A's library: the same answers, over four fake maps. */
const FAKE_LIBRARY = {
  getEncounterMap: (id) => MAPS.find((m) => m.id === id) ?? null,
  normalizePrefs: (raw) => raw ?? {},
  resolveDefaultMap: (terrain) => MAPS.find((m) => m.variant === "day" && m.terrains.includes(terrain)) ?? null,
  pickVariant: (map, { night = false, camping = false } = {}) => {
    const camp = camping && map.id === GROVE.id ? GROVE_CAMP : null;
    return { map: camp ?? map, darkness: night ? NIGHT_DARKNESS : 0, camp: !!camp };
  },
  partyZone: (map) => [...map.party],
};

const squareGrid = (size) => ({
  size, isHexagonal: false, isGridless: false,
  getTopLeftPoint: ({ x, y }) => ({ x: Math.floor(x / size) * size, y: Math.floor(y / size) * size }),
});
/** Every other column sits half a square lower, as the columns of a flat-topped hex grid do: no square lattice. */
const staggeredGrid = (size) => ({
  size, isHexagonal: true, isGridless: false,
  getTopLeftPoint: ({ x, y }) => {
    const column = Math.floor(x / size);
    const drop = (Math.abs(column) % 2) * (size / 2);
    return { x: column * size, y: Math.floor((y - drop) / size) * size + drop };
  },
});

const sourceFor = (name, extra = {}) => ({
  name, width: 1, height: 1, texture: { src: `${name}.webp` }, level: "hexLevel", shape: 0, actorLink: false,
  flags: { "some-module": { keep: true } }, disposition: -1, ...extra,
});

const WOLF_UUID = "Compendium.shadowdark.monsters.Actor.wolf";
let world;

function makeWorld({ gm = true, settings = {} } = {}) {
  const w = {
    notes: [], scenes: collection([]), actors: collection([]), folders: collection([]), combatList: [], viewedCombat: null,
    viewed: null, activated: [], sceneCreates: [], cloneCalls: [], folderCreates: [], deleteCalls: [],
    settings: { [SETTINGS.preload]: true, [SETTINGS.prefs]: {}, ...settings },
    onFlagWrite: () => null, onCreateTokens: () => null, activateWorks: true, folderFails: false, thumbOnCreate: "data:from-foundry",
    preload: { log: [], result: null }, cloneFails: false, canvasSceneId: null,
    // token deletes: a predicate for the tokens a preDeleteToken hook vetoes; whether a batch of several is refused; whether a delete throws after doing it
    vetoDelete: () => false, failBatchDelete: false, deleteThrowsAfter: false,
    // combats: "throwAfter" saves the combat and then rejects; a hook can refuse its deletion; an observer sees it as the deleteCombat hooks do
    combatCreate: null, vetoCombatDelete: false, onDeleteCombat: null,
  };
  w.keys = (level) => w.notes.filter(([l]) => !level || l === level).map(([, text]) => text.split("|")[0]);

  w.addActor = (data) => { const actor = { uuid: `Actor.${data.id}`, flags: {}, ...data }; w.actors.contents.push(actor); return actor; };

  w.addToken = (scene, data) => {
    const token = {
      id: data._id ?? nextId("tok"), actorId: data.actorId, x: data.x, y: data.y, width: data.width ?? 1, height: data.height ?? 1,
      level: data.level, shape: data.shape, actorLink: !!data.actorLink, name: data.name ?? "Token", flags: structuredClone(data.flags ?? {}),
      texture: structuredClone(data.texture ?? { src: null }),
      light: structuredClone(data.light ?? { dim: 0, bright: 0 }),
      actor: w.actors.get(data.actorId) ?? null, parent: scene,
      toObject() {
        return structuredClone({
          _id: this.id, actorId: this.actorId, x: this.x, y: this.y, width: this.width, height: this.height,
          level: this.level, shape: this.shape, actorLink: this.actorLink, name: this.name, flags: this.flags, texture: this.texture,
          light: this.light,
        });
      },
      // Document#clone: the data it is given is merged into the source, nested objects (flags) included
      clone(over) {
        const d = this.toObject();
        for (const [k, v] of Object.entries(over)) d[k] = k === "flags" ? deepMerge(d.flags, v) : v;
        delete d._id;
        return { toObject: () => d };
      },
    };
    scene.tokens.contents.push(token);
    return token;
  };

  w.addScene = ({
    id = nextId("scn"), name = id, flags = {}, width = 4000, height = 3000, grid = 100, gridKind = "square", active = false, darkness = 0,
    shiftX = 0, shiftY = 0, environment = {},
  } = {}) => {
    const scene = {
      id, name, flags: structuredClone(flags), active, thumb: "data:thumb", folder: null, updates: [], log: [], lights: [],
      environment: { darknessLevel: darkness, ...structuredClone(environment) },
      grid: gridKind === "staggered" ? staggeredGrid(grid) : squareGrid(grid),
      // padding puts the map inside a bigger canvas, and the background's shift moves it again: the origin of the map is
      // not (0, 0), and not on the grid when the shift is not a whole square (700 and 1400 are whole squares of 100 and 70)
      dimensions: { sceneX: 700 - shiftX, sceneY: 1400 - shiftY, sceneWidth: width, sceneHeight: height },
      initialLevel: { id: `level-${id}` }, tokens: collection([]),
      async update(data, options) {
        this.updates.push({ keys: Object.keys(data), options });
        for (const [path, value] of Object.entries(data)) {
          if (path.startsWith(`flags.${MOD}.`)) {
            const key = path.slice(`flags.${MOD}.`.length);
            const mode = w.onFlagWrite(this, key, value instanceof Replacement ? value.value : value);
            if (mode === "veto") return undefined;
            const stored = value instanceof Replacement ? structuredClone(value.value) : value;
            // "mangle": something stored the record without its list of characters who were on the scene already
            if (mode === "mangle" && stored && typeof stored === "object") delete stored.presentTokenIds;
            (this.flags[MOD] ??= {})[key] = stored;
            if (mode === "throwAfter") throw new Error("_onUpdate threw after the change was applied");
          } else setPath(this, path, value);
        }
        return this;
      },
      async createEmbeddedDocuments(name, datas) {
        if (name === "AmbientLight") {
          const made = datas.map((d) => ({ id: nextId("lgt"), ...structuredClone(d) }));
          this.lights.push(...made);
          return made;
        }
        const mode = w.onCreateTokens(this, datas);
        if (mode === "throwBefore") throw new Error("the create was refused");
        const made = datas.map((d) => w.addToken(this, d));
        this.log.push(["create", ...made.map((t) => t.id)]);
        if (mode === "throwAfter") throw new Error("_onCreate threw after the tokens were saved");
        return made;
      },
      async updateEmbeddedDocuments(name, updates) {
        if (name === "AmbientLight") {
          if (w.failLightUpdate) throw new Error("the light update was refused");
          for (const { _id, ...changes } of updates) {
            Object.assign(this.lights.find((l) => l.id === _id), changes);
            this.log.push(["light", _id, changes.hidden]);
          }
          return updates;
        }
        // v14's batch is strict here too: an id the collection does not have throws, and nothing in it is applied
        const missing = updates.find((u) => !this.tokens.contents.some((t) => t.id === u._id));
        if (missing) throw new Error(`Token "${missing._id}" does not exist!`);
        if (w.failTokenUpdate) throw new Error("the token update was refused");
        const changed = updates.map((u) => {
          const token = this.tokens.get(u._id);
          for (const [key, value] of Object.entries(u)) if (key !== "_id") token[key] = structuredClone(value);
          return token;
        });
        this.log.push(["update", ...changed.map((t) => t.id)]);
        return changed;
      },
      async deleteEmbeddedDocuments(name, ids) {
        const items = this.tokens.contents;
        this.log.push(["delete", ...ids]);
        w.deleteCalls.push([this.id, [...ids]]);
        // v14's batch is strict: an id the collection does not have throws, and nothing in the batch is deleted
        const missing = ids.find((id) => !items.some((t) => t.id === id));
        if (missing) throw new Error(`Token "${missing}" does not exist!`);
        if (w.failBatchDelete && ids.length > 1) throw new Error("the batch was refused");
        // a preDeleteToken hook can veto a token: it just stays, and the call still resolves
        const gone = items.filter((t) => ids.includes(t.id) && !w.vetoDelete(t));
        for (const t of gone) items.splice(items.indexOf(t), 1);
        if (w.deleteThrowsAfter) throw new Error("_onDelete threw after the tokens were deleted");
        return gone;
      },
      async view() { w.viewed = this.id; },
      async activate() {
        if (!w.activateWorks) return this;
        for (const s of w.scenes.contents) s.active = s === this;
        w.activated.push(this.id);
        return this;
      },
      async createThumbnail() { return { thumb: "data:made-by-hand" }; },
      async clone(createData, options) {
        w.cloneCalls.push({ createData, options });
        if (w.cloneFails) return undefined;
        const flagsCopy = structuredClone(this.flags);
        for (const [scope, value] of Object.entries(createData.flags ?? {})) {
          flagsCopy[scope] = value instanceof Replacement ? structuredClone(value.value) : { ...flagsCopy[scope], ...value };
        }
        const copy = w.addScene({ name: createData.name, flags: flagsCopy, width, height });
        copy.folder = createData.folder;
        w.log?.push("clone");
        // the sidebar's Duplicate: the tokens come along under their own ids
        for (const t of this.tokens.contents) w.addToken(copy, { ...t.toObject(), _id: t.id });
        return copy;
      },
    };
    w.scenes.contents.push(scene);
    return scene;
  };

  w.battleOf = (scene) => scene.flags?.[MOD]?.[FLAGS.battle] ?? null;
  w.flaggedTokens = (scene, battleId) => scene.tokens.contents.filter((t) => t.flags?.[MOD]?.[FLAGS.token] === battleId);
  /** A token's place on its map: the canvas point less the scene rect's origin. */
  w.rel = (scene, t) => ({ x: t.x - scene.dimensions.sceneX, y: t.y - scene.dimensions.sceneY });
  /** Where a map point is on the canvas. */
  w.canvas = (scene, x, y) => ({ x: scene.dimensions.sceneX + x, y: scene.dimensions.sceneY + y });

  const prior = {};
  for (const name of ["game", "ui", "CONST", "Combat", "TokenDocument", "Scene", "Folder", "canvas", "fromUuid", "_replace"]) {
    prior[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  }
  w.restore = () => {
    for (const [name, descriptor] of Object.entries(prior)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };

  globalThis._replace = (value) => new Replacement(value);
  globalThis.CONST = { GRID_TYPES: { SQUARE: 1 }, TOKEN_SHAPES: { ELLIPSE_1: 0, RECTANGLE_1: 4 } };
  globalThis.canvas = { get scene() { return w.canvasSceneId ? w.scenes.get(w.canvasSceneId) : null; } };
  globalThis.ui = { notifications: Object.fromEntries(["warn", "info", "error"].map((level) => [level, (text) => w.notes.push([level, text])])) };
  globalThis.game = {
    user: { isGM: gm, id: "gm1" },
    scenes: Object.defineProperty(w.scenes, "current", { get: () => w.scenes.get(w.viewed), configurable: true }),
    actors: w.actors,
    folders: w.folders,
    combats: { get: (id) => w.combatList.find((c) => c.id === id), get contents() { return w.combatList; }, get viewed() { return w.viewedCombat; } },
    settings: { get(mod, key) { if (!(key in w.settings)) throw new Error(`"${mod}.${key}" is not a registered game setting`); return w.settings[key]; } },
    i18n: { localize: (k) => STRINGS[k] ?? k, format: (k, d) => `${STRINGS[k] ?? k}|${JSON.stringify(d)}` },
  };
  globalThis.Scene = {
    async create(data) {
      w.sceneCreates.push(structuredClone(data));
      const scene = w.addScene({
        name: data.name, flags: data.flags, width: data.width, height: data.height, grid: data.grid?.size,
        darkness: data.environment?.darknessLevel, environment: { globalLight: data.environment?.globalLight },
      });
      scene.folder = data.folder;
      scene.thumb = w.thumbOnCreate;
      return scene;
    },
  };
  globalThis.Folder = {
    async create(data) {
      if (w.folderFails) throw new Error("no folder for you");
      const folder = { id: nextId("fld"), name: data.name, type: data.type, flags: structuredClone(data.flags ?? {}) };
      w.folders.contents.push(folder);
      w.folderCreates.push(folder);
      return folder;
    },
  };
  globalThis.Combat = {
    async create(data) {
      if (w.combatCreate === "throwBefore") throw new Error("the combat was refused");
      const combat = {
        id: nextId("cmb"), ...structuredClone(data), combatants: [], started: false, round: 0, deleted: false,
        async activate() { this.active = true; },
        async delete() {
          if (w.vetoCombatDelete) return undefined;
          // the deleteCombat hooks run with the combat out of the world and its combatants as they are: what they can read
          // is whatever the scene still has
          w.onDeleteCombat?.(this);
          this.deleted = true;
          w.combatList.splice(w.combatList.indexOf(this), 1);
          return this;
        },
      };
      w.combatList.push(combat);
      if (w.combatCreate === "throwAfter") throw new Error("_onCreate threw after the combat was saved");
      return combat;
    },
  };
  globalThis.TokenDocument = {
    implementation: {
      async createCombatants(tokens, { combat } = {}) {
        // Foundry falls back to the combat the GM is viewing: the tests make that a different combat on purpose
        const into = combat ?? w.viewedCombat;
        into.combatants.push(...tokens.map((t) => ({ id: nextId("cbt"), tokenId: t.id })));
      },
    },
  };
  globalThis.fromUuid = async () => null;
  return w;
}

const pcSource = (name) => sourceFor(name, { disposition: 1 });

/**
 * The party and the wolves the fake loaders hand out; `world.actors` knows them so tokens can say what they are.
 * `wolf` lets a test give the wolves' prototype token numbering, and a source name as Foundry would have given it.
 */
function seedActors(w, { pcs = 3, wolf: wolfOptions = {} } = {}) {
  const party = [];
  for (let i = 1; i <= pcs; i++) {
    const actor = w.addActor({ id: `pc${i}`, type: "Player", name: `Hero ${i}`, prototypeToken: { light: { dim: 0, bright: 0 } } });
    party.push({ actor, source: pcSource(actor.name), link: true });
  }
  const wolf = w.addActor({ id: "wolf", type: "NPC", name: "Wolf", prototypeToken: { name: "Wolf", ...wolfOptions.prototypeToken } });
  const foeSource = sourceFor(wolfOptions.sourceName ?? "Wolf", wolfOptions.source);
  _deps.party = async () => party;
  _deps.foe = async (uuid) => (uuid === WOLF_UUID ? { actor: wolf, source: foeSource } : null);
  return { party, wolf };
}

const WOLVES = { kind: "monster", uuid: WOLF_UUID, name: "Wolf", count: 4, distanceRoll: 3, activityRoll: 8, reactionRoll: 7, img: "wolf.webp" };

const consoleBackup = { warn: console.warn, error: console.error };

beforeEach(() => {
  // the flows log what they swallow (a create that threw after saving, a copy that failed): not noise in the test report
  console.warn = () => {};
  console.error = () => {};
  seq = 0;
  world = makeWorld();
  Object.assign(_deps, REAL_DEPS);
  _deps.maps = async () => FAKE_LIBRARY;
  _deps.preload = async () => ({
    startPreload: async (scene) => { world.preload.log.push(["start", scene.id, scene.tokens.contents.length]); return world.preload.result; },
    stopPreload: (id) => { world.preload.log.push(["stop", id]); },
  });
});
afterEach(() => {
  world.restore();
  Object.assign(_deps, REAL_DEPS);
  console.warn = consoleBackup.warn;
  console.error = consoleBackup.error;
});

// ─── encounter-scene.mjs ─────────────────────────────────────────────────────

test("encounterSceneName: the prefix and the map's own label", () => {
  assert.equal(encounterSceneName(GROVE), "Encounter: Fake grove");
});

test("findEncounterScene: by flag first (a rename survives), then by the name it would have", () => {
  const real = getEncounterMap("forest-woods");
  assert.ok(real, "the library has forest-woods");
  const renamed = world.addScene({ name: "My woods", flags: { [MOD]: { [FLAGS.scene]: "forest-woods" } } });
  world.addScene({ name: encounterSceneName(real) });
  assert.equal(findEncounterScene("forest-woods"), renamed, "the flagged scene wins over the one with the name");
  world.scenes.contents.splice(world.scenes.contents.indexOf(renamed), 1);
  assert.equal(findEncounterScene("forest-woods").name, encounterSceneName(real), "no flag anywhere: the name matches");
  assert.equal(findEncounterScene("no-such-map"), null);
  assert.equal(findEncounterScene("forest-edge-of-the-woods"), null, "a known map nobody has made yet");
});

test("findEncounterScene: given the map itself it finds the scene by name for a map the library does not know", () => {
  const named = world.addScene({ name: "Encounter: Fake grove" });
  assert.equal(findEncounterScene("fake-grove"), null, "by id alone the real library has never heard of it");
  assert.equal(findEncounterScene("fake-grove", GROVE), named);
});

test("ensureEncounterScene: makes the scene once, as a v14 level in the Encounter maps folder, not active, not on the nav bar", async () => {
  const { scene, created } = await ensureEncounterScene(GROVE);
  assert.equal(created, true);
  const data = world.sceneCreates[0];
  assert.equal(data.name, "Encounter: Fake grove");
  assert.equal(data.active, false, "active:false is explicit: a world with no active scene would otherwise make this one");
  assert.equal(data.navigation, false);
  assert.equal(data.width, 4000);
  assert.equal(data.height, 3000);
  assert.equal(data.padding, 0.05);
  assert.deepEqual(data.levels, [{ name: "Fake grove", background: { src: GROVE.image } }]);
  assert.ok(!("background" in data), "the picture is on a level; Foundry 14 cleans a scene-level background away");
  assert.deepEqual(data.grid, { type: 1, size: 100, distance: 5, units: "ft", alpha: 0.12, color: "#000000" });
  assert.equal(data.tokenVision, true);
  assert.deepEqual(data.environment, { darknessLevel: 0, globalLight: { enabled: true, darkness: { min: 0, max: 0.5 } } });
  assert.deepEqual(data.flags, { [MOD]: { [FLAGS.scene]: "fake-grove", encounterMapLight: 1 } });
  const folder = world.folders.contents[0];
  assert.equal(folder.name, "Mapas de encuentro", "named in the GM's language");
  assert.equal(folder.type, "Scene");
  assert.equal(data.folder, folder.id);
  assert.equal(scene.active, false);
  assert.equal(world.viewed, null, "not viewed unless asked");

  const again = await ensureEncounterScene(GROVE);
  assert.equal(again.created, false);
  assert.equal(again.scene, scene);
  assert.equal(world.sceneCreates.length, 1, "one scene per map");
  assert.equal(world.folderCreates.length, 1);
  assert.equal(scene.updates.length, 0, "and nothing is written to a scene that is as it should be");
});

test("ensureEncounterScene: a day battle is lit for the players and a night one is dark again", async () => {
  // Foundry gives a token no sight of its own, so without a global light a daylight scene is black to the players. The
  // light is on while the darkness is within [min, max]; the arena's old `enabled: false` is for a battle always at night.
  const { scene } = await ensureEncounterScene(GROVE);
  const light = scene.environment.globalLight;
  assert.equal(light.enabled, true);
  const lit = (darkness) => light.enabled && darkness >= light.darkness.min && darkness <= light.darkness.max;
  assert.equal(lit(0), true, "noon");
  assert.equal(lit(NIGHT_DARKNESS), false, "night");
  assert.equal(scene.flags[MOD].encounterMapLight, 1, "marked as having its daylight");
});

test("ensureEncounterScene: a scene made before the daylight existed is given it once, and nothing else of the GM's is touched", async () => {
  const old = world.addScene({
    name: "Encounter: Fake grove", flags: { [MOD]: { [FLAGS.scene]: GROVE.id, mine: "kept" } },
    environment: { cycle: false, globalLight: { enabled: false, alpha: 0.3, darkness: { min: 0, max: 1 } } },
  });
  const { scene, created } = await ensureEncounterScene(GROVE);
  assert.equal(scene, old);
  assert.equal(created, false);
  assert.equal(old.environment.globalLight.enabled, true);
  assert.deepEqual(old.environment.globalLight.darkness, { min: 0, max: 0.5 });
  assert.equal(old.environment.globalLight.alpha, 0.3, "the rest of the light is the GM's");
  assert.equal(old.environment.cycle, false);
  assert.equal(old.flags[MOD].mine, "kept");
  assert.equal(old.flags[MOD][FLAGS.scene], GROVE.id);
  assert.deepEqual(old.updates.map((u) => u.keys), [[
    "environment.globalLight.enabled", "environment.globalLight.darkness.min", "environment.globalLight.darkness.max", `flags.${MOD}.encounterMapLight`,
  ]], "one update, through the flag helper, with the daylight and its marker");

  // once: a GM who turns it off afterwards is not argued with
  old.environment.globalLight.enabled = false;
  await ensureEncounterScene(GROVE);
  await ensureEncounterScene(GROVE);
  assert.equal(old.environment.globalLight.enabled, false);
  assert.equal(old.updates.length, 1);
});

test("ensureEncounterScene: the repair and this battle's darkness are one write", async () => {
  const old = world.addScene({ name: "Encounter: Fake grove", flags: { [MOD]: { [FLAGS.scene]: GROVE.id } }, environment: { globalLight: { enabled: false } } });
  await ensureEncounterScene(GROVE, { night: true });
  assert.equal(old.updates.length, 1);
  assert.equal(old.environment.darknessLevel, NIGHT_DARKNESS);
  assert.equal(old.environment.globalLight.enabled, true);
});

test("ensureEncounterScene: two quick calls make one scene", async () => {
  const [a, b] = await Promise.all([ensureEncounterScene(GROVE), ensureEncounterScene(GROVE)]);
  assert.equal(a.scene, b.scene);
  assert.equal(world.sceneCreates.length, 1);
  assert.equal(world.folderCreates.length, 1);
});

test("ensureEncounterScene: a scene is found again whatever it was renamed to, or by name when it lost its flag", async () => {
  const flagged = world.addScene({ name: "Renamed by the GM", flags: { [MOD]: { [FLAGS.scene]: GROVE.id } } });
  assert.equal((await ensureEncounterScene(GROVE)).scene, flagged);
  world.scenes.contents.length = 0;
  const named = world.addScene({ name: "Encounter: Fake grove" });
  assert.equal((await ensureEncounterScene(GROVE)).scene, named);
  assert.equal(world.sceneCreates.length, 0);
});

test("ensureEncounterScene: night is darkness, set on a new scene and on a reused one", async () => {
  const { scene } = await ensureEncounterScene(GROVE, { night: true });
  assert.equal(world.sceneCreates[0].environment.darknessLevel, NIGHT_DARKNESS);
  await ensureEncounterScene(GROVE, { night: false });
  assert.equal(scene.environment.darknessLevel, 0, "the next battle is by day");
  await ensureEncounterScene(GROVE, { night: false });
  assert.equal(scene.updates.length, 1, "nothing is written when the darkness already matches");
});

test("ensureEncounterScene: a camp map has one campfire, in canvas coordinates; a day map has none", async () => {
  const day = await ensureEncounterScene(GROVE);
  assert.equal(day.scene.lights.length, 0);
  const { scene } = await ensureEncounterScene(GROVE_CAMP);
  assert.equal(scene.lights.length, 1);
  const [light] = scene.lights;
  assert.deepEqual({ x: light.x, y: light.y }, world.canvas(scene, 2000, 1500), "the image point plus the scene rect's origin");
  assert.equal(light.config.bright, 15);
  assert.equal(light.config.dim, 30);
  assert.match(light.config.color, /^#[0-9a-f]{6}$/i);
  assert.equal(world.sceneCreates[1].flags[MOD][FLAGS.scene], "fake-grove-camp", "a camp is a scene of its own");
  await ensureEncounterScene(GROVE_CAMP);
  assert.equal(scene.lights.length, 1, "reusing it does not add a second fire");
});

test("ensureEncounterScene: the campfire is lit while the camp has a fire and out when it has none, on a new scene and a reused one", async () => {
  const lightWrites = (scene) => scene.log.filter(([kind]) => kind === "light").length;
  const { scene } = await ensureEncounterScene(GROVE_CAMP, { fire: false });
  assert.equal(scene.lights.length, 1, "a camp without a fire still has its light, out, for the GM to light");
  assert.equal(scene.lights[0].hidden, true);
  assert.equal(scene.lights[0].flags[MOD].campfire, true, "marked as this builder's own");

  await ensureEncounterScene(GROVE_CAMP, { fire: true });
  assert.deepEqual([scene.lights.length, scene.lights[0].hidden, lightWrites(scene)], [1, false, 1], "lit again, on the same light");
  await ensureEncounterScene(GROVE_CAMP);
  assert.equal(lightWrites(scene), 1, "a fire is burning unless the camp says otherwise, and nothing is written when it already matches");
  await ensureEncounterScene(GROVE_CAMP, { fire: false });
  assert.deepEqual([scene.lights.length, scene.lights[0].hidden, lightWrites(scene)], [1, true, 2]);

  scene.lights[0].x += 300;
  await ensureEncounterScene(GROVE_CAMP, { fire: true });
  assert.deepEqual([scene.lights.length, scene.lights[0].hidden], [1, false], "a light the GM moved is still the fire");

  scene.lights.length = 0;
  await ensureEncounterScene(GROVE_CAMP, { fire: true });
  assert.deepEqual([scene.lights.length, scene.lights[0].hidden], [1, false], "a light the GM deleted is made again");
});

test("ensureEncounterScene: a campfire made before the light was marked is found by where it stands, not made twice", async () => {
  const old = world.addScene({ name: encounterSceneName(GROVE_CAMP), flags: { [MOD]: { [FLAGS.scene]: GROVE_CAMP.id } } });
  old.lights.push({ id: "old", ...world.canvas(old, 2000, 1500), hidden: false, config: { bright: 15, dim: 30 } });
  await ensureEncounterScene(GROVE_CAMP, { fire: false });
  assert.deepEqual(old.lights.map((l) => [l.id, l.hidden]), [["old", true]]);
});

test("ensureEncounterScene: a campfire that will not go out or come on costs the glow, not the battle", async () => {
  const { scene } = await ensureEncounterScene(GROVE_CAMP, { fire: true });
  world.failLightUpdate = true;
  await assert.doesNotReject(ensureEncounterScene(GROVE_CAMP, { fire: false }));
  assert.equal(scene.lights[0].hidden ?? false, false, "the light is as it was");
});

test("ensureEncounterScene: the folder is found by its flag (a GM may rename it), then by its name in the GM's language, then by the English name an earlier version gave it", async () => {
  const renamed = { id: "f1", name: "My maps", type: "Scene", flags: { [MOD]: { encounterFolder: "maps" } } };
  const otherType = { id: "f2", name: "Mapas de encuentro", type: "Actor", flags: {} };
  world.folders.contents.push(otherType, renamed);
  const { scene } = await ensureEncounterScene(GROVE);
  assert.equal(scene.folder, "f1", "the flag wins over a name, and a folder of another type is not a scene folder");
  assert.equal(world.folderCreates.length, 0);

  world.folders.contents.length = 0;
  const localized = { id: "f3", name: "Mapas de encuentro", type: "Scene", flags: {} };
  const legacy = { id: "f4", name: FOLDERS.maps, type: "Scene", flags: {} };
  world.folders.contents.push(legacy, localized);
  assert.equal((await ensureEncounterScene(LAKE)).scene.folder, "f3", "the localized name before the old one");

  world.folders.contents.length = 0;
  world.folders.contents.push(legacy);
  assert.equal((await ensureEncounterScene(ISLES)).scene.folder, "f4", "a world that has the English-named folder keeps using it");
  assert.equal(world.folderCreates.length, 0, "none of that made a folder");
});

test("ensureEncounterScene: the saved folder follows the same order, and a new one is named in the GM's language and flagged", async () => {
  const { scene } = await ensureEncounterScene(GROVE);
  const copy = await copyAsSaved(scene, { label: "one" });
  const made = world.folders.contents.find((f) => f.flags[MOD]?.encounterFolder === "saved");
  assert.equal(made.name, "Encuentros guardados");
  assert.equal(copy.folder, made.id);
  world.folders.contents.splice(world.folders.contents.indexOf(made), 1);
  const legacy = { id: "old", name: FOLDERS.saved, type: "Scene", flags: {} };
  world.folders.contents.push(legacy);
  assert.equal((await copyAsSaved(scene, { label: "two" })).folder, "old");
});

test("ensureEncounterScene: if the folder cannot be made the scene still is, at the top level", async () => {
  world.folderFails = true;
  const { scene } = await ensureEncounterScene(GROVE);
  assert.equal(scene.folder, null);
});

test("ensureEncounterScene: the thumbnail is made by hand when Foundry did not, and not when it did", async () => {
  world.thumbOnCreate = "";
  const { scene } = await ensureEncounterScene(GROVE);
  assert.equal(scene.thumb, "data:made-by-hand");
  world.thumbOnCreate = "data:from-foundry";
  const other = await ensureEncounterScene(LAKE);
  assert.equal(other.scene.thumb, "data:from-foundry");
  assert.equal(other.scene.updates.length, 0);
});

test("ensureEncounterScene: a thumbnail that fails costs nothing", async () => {
  world.thumbOnCreate = "";
  const create = globalThis.Scene.create;
  globalThis.Scene.create = async (data) => { const s = await create(data); s.createThumbnail = async () => { throw new Error("no canvas"); }; return s; };
  const { scene, created } = await ensureEncounterScene(GROVE);
  assert.equal(created, true);
  assert.equal(scene.thumb, "");
});

test("ensureEncounterScene: viewed only when asked, and never activated", async () => {
  const { scene } = await ensureEncounterScene(GROVE, { view: true });
  assert.equal(world.viewed, scene.id);
  assert.equal(scene.active, false);
  assert.deepEqual(world.activated, []);
  world.viewed = null;
  await ensureEncounterScene(GROVE, { view: true });
  assert.equal(world.viewed, scene.id, "also when it is reused");
});

test("copyAsSaved: the sidebar's own Duplicate into Saved encounters, with the module's flags replaced", async () => {
  const { scene } = await ensureEncounterScene(GROVE);
  world.addToken(scene, { actorId: "pc1", x: 500, y: 500, flags: { [MOD]: { [FLAGS.token]: "B1" } } });
  const copy = await copyAsSaved(scene, { label: "4 Wolf (Fake grove)" });
  const [{ createData, options }] = world.cloneCalls;
  assert.deepEqual(options, { save: true, addSource: true, discardInvalidEmbedded: true });
  assert.equal(createData.name, "4 Wolf (Fake grove)");
  const folder = world.folders.contents.find((f) => f.name === "Encuentros guardados");
  assert.equal(folder.flags[MOD].encounterFolder, "saved");
  assert.equal(createData.folder, folder.id);
  assert.ok(createData.flags[MOD] instanceof Replacement, "replaced, not merged: the copy must not carry the map's flag or a battle record");
  assert.equal(copy.flags[MOD][FLAGS.scene], undefined);
  assert.equal(copy.flags[MOD][FLAGS.battle], undefined);
  assert.equal(copy.flags[MOD][FLAGS.saved].mapId, "fake-grove");
  assert.equal(copy.flags[MOD][FLAGS.saved].label, "4 Wolf (Fake grove)");
  assert.ok(Number.isFinite(copy.flags[MOD][FLAGS.saved].at));
  assert.equal(copy.tokens.contents.length, 1, "the tokens come along");
  assert.equal(copy.folder, folder.id);
  assert.equal(findEncounterScene(GROVE.id, GROVE), scene, "and the map's own scene is still the one a battle will use");
});

test("copyAsSaved: an unlabelled copy is named for its scene; a clone Foundry did not make is null", async () => {
  const { scene } = await ensureEncounterScene(GROVE);
  const copy = await copyAsSaved(scene);
  assert.equal(copy.name, "SDE.encounterMaps.scene.savedName|{\"scene\":\"Encounter: Fake grove\"}");
  world.cloneFails = true;
  assert.equal(await copyAsSaved(scene, { label: "x" }), null);
});

// ─── setUp ───────────────────────────────────────────────────────────────────

test("setUp: the terrain's default map, the party and the monsters on it, a staged record, viewed and never activated", async () => {
  const { party } = seedActors(world);
  world.addScene({ id: "hex", name: "Hex map", active: true });
  world.canvasSceneId = "hex";
  const answer = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", hex: 203 });
  const { battle, scene, map, created } = answer;
  assert.equal(map, GROVE);
  assert.equal(created, true);
  assert.equal(answer.existing, undefined, "a battle that is new is not an existing one");
  assert.equal(scene.flags[MOD][FLAGS.scene], "fake-grove");
  assert.deepEqual(world.activated, []);
  assert.equal(world.scenes.get("hex").active, true, "the table stays on the hex map");
  assert.equal(world.viewed, scene.id, "the GM looks at it");
  assert.equal(scene.active, false);

  // the record
  const stored = world.battleOf(scene);
  assert.deepEqual(stored, battle);
  assert.equal(stored.status, "staged");
  assert.equal(stored.originSceneId, "hex", "the viewed scene is where Return goes back to");
  assert.equal(stored.mapId, "fake-grove");
  assert.equal(stored.sceneId, scene.id);
  assert.equal(stored.terrain, "forest");
  assert.equal(stored.hex, 203);
  assert.equal(stored.variant, "day");
  assert.equal(stored.combatId, null);
  assert.deepEqual(stored.presentTokenIds, [], "nobody was on the scene already");
  assert.deepEqual(stored.encounter, { name: "Wolf", uuid: WOLF_UUID, count: 4, distanceRoll: 3, activityRoll: 8, reactionRoll: 7, img: "wolf.webp" }, "what the panel tells of the foes is kept with the battle");
  assert.equal(scene.tokens.contents.length, 7);
  assert.deepEqual(stored.tokenIds.slice().sort(), scene.tokens.contents.map((t) => t.id).sort());
  assert.equal(scene.log.filter(([op]) => op === "create").length, 1, "one create call for all of them");

  // every token: ours, on this scene's level, square, and the party linked
  const pcs = scene.tokens.contents.filter((t) => t.actor.type === "Player");
  const wolves = scene.tokens.contents.filter((t) => t.actor.type === "NPC");
  assert.equal(pcs.length, party.length);
  assert.equal(wolves.length, 4);
  for (const t of scene.tokens.contents) {
    assert.equal(t.flags[MOD][FLAGS.token], stored.id);
    assert.equal(t.flags["some-module"].keep, true, "the prototype's own flags are kept");
    assert.equal(t.level, `level-${scene.id}`, "the level of THIS scene, not the hex scene's");
    assert.equal(t.shape, 4, "a square: the source was made while a hex grid was viewed and came out an ellipse");
    assert.ok(t.x % 100 === 0 && t.y % 100 === 0, "on the scene's grid");
  }
  assert.ok(pcs.every((t) => t.actorLink), "the party is linked so damage lands on the character");
  assert.ok(wolves.every((t) => !t.actorLink), "the monsters keep their prototype: each has its own hit points");

  // where: the party inside its zone, the wolves "near" (5 empty squares) past its edge: 6 squares, 30 ft, from the front character
  const at = (t) => world.rel(scene, t);
  assert.ok(pcs.every((t) => at(t).x >= 1300 && at(t).x + 100 <= 2700 && at(t).y >= 900 && at(t).y + 100 <= 2100));
  const frontPc = Math.max(...pcs.map((t) => at(t).x + 100));
  const frontWolf = Math.min(...wolves.map((t) => at(t).x));
  assert.equal(frontWolf - frontPc, 5 * 100, "near: 5 empty squares between the front ranks");
  const cells = scene.tokens.contents.map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(cells).size, cells.length, "nobody on anybody");

  // the flag was written through replaceModuleFlag: one key, the map's flag beside it untouched
  assert.deepEqual(scene.updates.map((u) => u.keys), [[`flags.${MOD}.battle`]]);
  assert.ok(scene.updates.every((u) => u.options?.recursive !== false));
  assert.equal(scene.flags[MOD][FLAGS.scene], "fake-grove");

  // current() and get()
  assert.deepEqual(BattleMaps.current(), { battle: stored, scene });
  assert.deepEqual(BattleMaps.get(stored.id), { battle: stored, scene });
  assert.equal(BattleMaps.get("nope"), null);
  assert.equal(BattleMaps.get(), null);
});

test("setUp: what it hands back is a copy, not the scene's stored flag", async () => {
  seedActors(world);
  const { battle, scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  battle.tokenIds.push("tampered");
  battle.status = "done";
  const copy = BattleMaps.current().battle;
  copy.encounter.name = "tampered";
  assert.equal(world.battleOf(scene).tokenIds.includes("tampered"), false);
  assert.equal(world.battleOf(scene).status, "staged");
  assert.equal(world.battleOf(scene).encounter.name, "Wolf");
});

test("setUp: the preload starts after the tokens exist, with the setting on, and a null from it is fine", async () => {
  seedActors(world);
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.deepEqual(world.preload.log, [["start", scene.id, 7]], "started once, with all seven tokens already there");
  assert.equal(world.preload.result, null);
});

test("setUp: no preload with the setting off, or when the setting does not exist yet", async () => {
  seedActors(world);
  world.settings[SETTINGS.preload] = false;
  await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.deepEqual(world.preload.log, []);
  delete world.settings[SETTINGS.preload];
  delete world.settings[SETTINGS.prefs];
  const second = await BattleMaps.setUp({ encounter: WOLVES, terrain: "lake" });
  assert.ok(second, "an unregistered preload setting and prefs setting are not errors");
  assert.deepEqual(world.preload.log, []);
});

test("setUp: a preload part that is missing or throws does not stop the battle", async () => {
  seedActors(world);
  _deps.preload = async () => { throw new Error("encounter-preload.mjs is not there"); };
  const answer = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.ok(answer);
  assert.equal(world.battleOf(answer.scene).status, "staged");
  _deps.preload = async () => ({ startPreload: async () => { throw new Error("socket closed"); }, stopPreload() {} });
  assert.ok(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", mapId: "fake-lake" }));
});

// ─── the readout after a reload ──────────────────────────────────────────────

test("resumeBattleReadout: the GM who set a staged battle up gets the players' readout back after a reload", async () => {
  // the readout's sessions live in the page: a reload left the panel with no rows and Bring the table nobody to ask about
  seedActors(world);
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(world.battleOf(scene).gmId, "gm1", "the record says whose readout it is");
  world.preload.log.length = 0;
  await resumeBattleReadout();
  assert.deepEqual(world.preload.log, [["start", scene.id, 7]], "started again for the scene, with its tokens");
});

test("resumeBattleReadout: not another GM, not a player, not a record from before, not with the preload off", async () => {
  seedActors(world);
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const resumed = async () => { world.preload.log.length = 0; await resumeBattleReadout(); return world.preload.log.length; };

  // a player reports to whoever asked last, so a second GM tab (or the bridge) reloading must not take the reports
  globalThis.game.user.id = "gm2";
  assert.equal(await resumed(), 0, "another GM");
  globalThis.game.user.id = "gm1";
  globalThis.game.user.isGM = false;
  assert.equal(await resumed(), 0, "a player");
  globalThis.game.user.isGM = true;
  world.settings[SETTINGS.preload] = false;
  assert.equal(await resumed(), 0, "the setting off");
  world.settings[SETTINGS.preload] = true;
  assert.equal(await resumed(), 1, "and the same GM, with the setting on, is the one");

  delete scene.flags[MOD][FLAGS.battle].gmId;
  assert.equal(await resumed(), 0, "a record written before it said whose it was: nobody takes it");
});

test("resumeBattleReadout: a live battle has no readout to resume, the table is already on the map", async () => {
  const { battle } = await staged();
  await BattleMaps.bringTable(battle.id);
  world.preload.log.length = 0;
  await resumeBattleReadout();
  assert.deepEqual(world.preload.log, []);
});

test("setUp: view:false leaves the GM where they are", async () => {
  seedActors(world);
  await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", view: false });
  assert.equal(world.viewed, null);
});

test("setUp: a player is refused politely and nothing is touched", async () => {
  world.restore();
  world = makeWorld({ gm: false });
  seedActors(world);
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }), null);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.gmOnly"]);
  assert.equal(world.scenes.contents.length, 0);
  assert.equal(world.sceneCreates.length, 0);
  assert.equal(await BattleMaps.bringTable("x"), null);
  assert.equal(await BattleMaps.returnToTravel("x"), null);
  assert.equal(await BattleMaps.changeMap("x", { mapId: "fake-lake" }), null);
  assert.equal(world.keys("warn").length, 4);
});

test("setUp: an unknown map, a terrain with no map, an unknown scene: told why, nothing made", async () => {
  seedActors(world);
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, mapId: "no-such-map" }), null);
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "desert" }), null);
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES }), null);
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, sceneId: "gone" }), null);
  assert.deepEqual(world.keys("warn"), [
    "SDE.encounterMaps.notify.unknownMap", "SDE.encounterMaps.notify.noMap", "SDE.encounterMaps.notify.noMap", "SDE.encounterMaps.notify.unknownScene",
  ]);
  assert.equal(world.sceneCreates.length, 0);
  assert.equal(BattleMaps.current(), null);
});

test("setUp: which map: a world scene as it stands, else the mapId, else the terrain's default", async () => {
  seedActors(world);
  const mine = world.addScene({ id: "dungeon", name: "Dungeon room", width: 2000, height: 1500, grid: 100, flags: { [MOD]: { other: 1 } } });
  const bySceneId = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", mapId: "fake-lake", sceneId: "dungeon" });
  assert.equal(bySceneId.scene, mine);
  assert.equal(bySceneId.map, null);
  assert.equal(bySceneId.created, false);
  assert.equal(world.sceneCreates.length, 0, "nothing is made for a scene the GM brought");
  assert.equal(mine.environment.darknessLevel, 0, "and its darkness is theirs");
  assert.equal(mine.environment.globalLight, undefined, "and so is its light");
  assert.equal(bySceneId.battle.mapId, null);
  assert.equal(mine.flags[MOD].other, 1, "the module's other flags on it survive");
  await BattleMaps.returnToTravel(bySceneId.battle.id);

  const byMapId = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", mapId: "fake-lake" });
  assert.equal(byMapId.map, LAKE);
  assert.equal(byMapId.scene.name, "Encounter: Fake lake");
  await BattleMaps.returnToTravel(byMapId.battle.id);

  const byTerrain = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(byTerrain.map, GROVE);
});

test("setUp: a world scene is laid out in its own middle, on its own grid, inside its own bounds", async () => {
  seedActors(world);
  const room = world.addScene({ id: "room", name: "Room", width: 1400, height: 1400, grid: 70 });
  const { scene } = await BattleMaps.setUp({ encounter: { ...WOLVES, count: 6 }, sceneId: "room" });
  assert.equal(scene.tokens.contents.length, 9);
  for (const t of room.tokens.contents) {
    const at = world.rel(room, t);
    assert.ok(t.x % 70 === 0 && t.y % 70 === 0, `${t.x},${t.y} is on a 70 px grid`);
    assert.ok(at.x >= 0 && at.x + 70 <= 1400 && at.y >= 0 && at.y + 70 <= 1400, "inside the scene");
  }
});

test("setUp: tokens on a scene whose background is shifted off the grid are still on the scene's grid", async () => {
  seedActors(world);
  // a background shifted 30 px right and 45 px down of the grid: the map's corner is not on a grid line
  const shifted = world.addScene({ id: "shifted", name: "Shifted", width: 2400, height: 1800, shiftX: 30, shiftY: 45 });
  assert.equal(shifted.dimensions.sceneX % 100, 70);
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "shifted" });
  assert.equal(scene.tokens.contents.length, 7);
  const cells = scene.tokens.contents.map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(cells).size, cells.length, "nobody on anybody");
  for (const t of scene.tokens.contents) {
    assert.ok(t.x % 100 === 0 && t.y % 100 === 0, `${t.x},${t.y} is on the grid`);
    const at = world.rel(scene, t);
    assert.ok(at.x > -100 && at.x < 2400 && at.y > -100 && at.y < 1800, "and on the map, to within a square");
  }
});

test("a layout spot becomes the point of the grid cell that holds the middle of the spot's first square", () => {
  const scene = (extra) => world.addScene({ width: 2400, height: 1800, ...extra });
  const plain = scene({});
  assert.deepEqual(_canvasSpot(plain, { x: 0, y: 0 }), { x: 700, y: 1400 }, "a map on the grid stays where it was laid");
  assert.deepEqual(_canvasSpot(plain, { x: 1500, y: 800 }), { x: 2200, y: 2200 });
  // the background shifted 30 right and 45 down of the grid: the nearest grid lines are 30 right and 45 down of the corner
  const shifted = scene({ shiftX: 30, shiftY: 45 });
  assert.equal(shifted.dimensions.sceneX, 670);
  assert.deepEqual(_canvasSpot(shifted, { x: 0, y: 0 }), { x: 700, y: 1400 });
  assert.deepEqual(_canvasSpot(shifted, { x: 1500, y: 800 }), { x: 2200, y: 2200 });
  // shifted 70: the nearest line is the one 30 to the LEFT of the corner, not the one 70 right of it
  assert.deepEqual(_canvasSpot(scene({ shiftX: 70 }), { x: 0, y: 0 }), { x: 600, y: 1400 });
  // a grid with no square lattice answers for itself
  const hex = scene({ gridKind: "staggered" });
  assert.deepEqual(_canvasSpot(hex, { x: 0, y: 0 }), { x: 700, y: 1450 }, "column 7 is half a square lower");
  assert.deepEqual(_canvasSpot(hex, { x: 100, y: 0 }), { x: 800, y: 1400 }, "and column 8 is not");
  // and a scene with no grid is left as laid
  const none = scene({});
  none.grid = { size: 100, isGridless: true, getTopLeftPoint: () => { throw new Error("no grid to ask"); } };
  assert.deepEqual(_canvasSpot(none, { x: 130, y: 55 }), { x: 830, y: 1455 });
});

test("setUp: on a grid that has no square lattice (hex) every token is where the grid itself puts a token", async () => {
  seedActors(world);
  world.addScene({ id: "hexy", name: "Hex battle", width: 2400, height: 1800, gridKind: "staggered" });
  const { scene } = await BattleMaps.setUp({ encounter: { ...WOLVES, count: 8 }, sceneId: "hexy" });
  assert.equal(scene.tokens.contents.length, 11);
  const cells = scene.tokens.contents.map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(cells).size, cells.length, "nobody on anybody");
  for (const t of scene.tokens.contents) {
    const column = t.x / 100;
    assert.ok(Number.isInteger(column), `${t.x} is a column`);
    assert.equal((t.y - (Math.abs(column) % 2) * 50) % 100, 0, `${t.x},${t.y}: every other column is half a square lower`);
    assert.equal(t.shape, 0, "and a hex scene keeps the hex shape");
  }
});

test("setUp: night and camp: the camp map's own scene, lit by the clock", async () => {
  seedActors(world);
  const camp = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", night: true, camping: true });
  assert.equal(camp.map, GROVE_CAMP);
  assert.equal(camp.scene.name, "Encounter: Fake grove (camp)");
  assert.equal(camp.scene.environment.darknessLevel, NIGHT_DARKNESS);
  assert.equal(camp.scene.lights.length, 1);
  assert.equal(camp.battle.variant, "camp");
  await BattleMaps.returnToTravel(camp.battle.id);

  const night = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", night: true });
  assert.equal(night.map, GROVE);
  assert.equal(night.scene.environment.darknessLevel, NIGHT_DARKNESS);
  assert.equal(night.battle.variant, "night");
  await BattleMaps.returnToTravel(night.battle.id);

  // the GM's pick beats the clock
  const day = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", night: true, camping: true, variant: "day" });
  assert.equal(day.map, GROVE);
  assert.equal(day.scene.environment.darknessLevel, 0);
  assert.equal(day.battle.variant, "day");
  await BattleMaps.returnToTravel(day.battle.id);

  const picked = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", variant: "camp" });
  assert.equal(picked.map, GROVE_CAMP);
  assert.equal(picked.scene.environment.darknessLevel, 0, "a camp by day keeps the day");
  assert.equal(world.sceneCreates.length, 2, "two scenes for the grove: the day map and its camp, reused across four battles");
});

test("setUp: a camp map's fire is the camp's own: lit while it burns, out when it was never lit or has gone out", async () => {
  seedActors(world);
  const party = world.addActor({ id: "party1", type: "NPC", name: "The party" });
  const record = (camping) => { party.flags = camping ? { [MOD]: { camping } } : {}; };
  const tonight = (camp) => { globalThis.game.shadowdarkEnhancer = { overland: { state: () => ({ camp }) } }; };
  const fireOnTheMap = async () => {
    const { scene, battle } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", night: true, camping: true, view: false });
    const lit = scene.lights.length === 1 && !scene.lights[0].hidden;
    await BattleMaps.returnToTravel(battle.id);
    return lit;
  };

  tonight({ party: party.uuid });
  record({ phase: "awaitingRest", fire: { lit: true } });
  assert.equal(await fireOnTheMap(), true, "the party's fire is burning");
  record({ phase: "awaitingRest", fire: { lit: false, started: 0 } });
  assert.equal(await fireOnTheMap(), false, "the fire went out: the camp is dark");
  record({ phase: "tasks" });
  assert.equal(await fireOnTheMap(), false, "no fire has been lit yet");
  record({ phase: "complete", fire: { lit: false } });
  assert.equal(await fireOnTheMap(), true, "last night's finished camp says nothing about this one");
  record(null);
  assert.equal(await fireOnTheMap(), true, "a camp made without the camping window has the fire its art shows");
  tonight({ party: "Actor.nobody" });
  record({ phase: "awaitingRest", fire: { lit: false } });
  assert.equal(await fireOnTheMap(), true, "a party the camp does not name has nothing to say about it");
  tonight(null);
  assert.equal(await fireOnTheMap(), true, "no camp tonight: a camp the GM picked is lit");
  assert.equal(world.sceneCreates.length, 1, "one scene, its one light switched, never a second");
});

test("setUp: a water map puts the party on the deck and the monsters in the water beside it", async () => {
  seedActors(world);
  const { scene } = await BattleMaps.setUp({ encounter: { ...WOLVES, distanceRoll: 6 }, terrain: "lake" });
  const at = (t) => world.rel(scene, t);
  const pcs = scene.tokens.contents.filter((t) => t.actor.type === "Player");
  const wolves = scene.tokens.contents.filter((t) => t.actor.type === "NPC");
  assert.ok(pcs.every((t) => at(t).x >= 1700 && at(t).x + 100 <= 2700 && at(t).y === 800), "the deck is one row of squares");
  assert.ok(wolves.every((t) => at(t).x >= 3800 && at(t).x + 100 <= 4400 && at(t).y >= 0 && at(t).y + 100 <= 1600), "far: 11 empty squares past the deck's end (2700), on the map");
});

test("setUp: a map that names where its foes go puts them there, whatever the roll, and the party on its own island", async () => {
  seedActors(world);
  const positions = [];
  for (const distanceRoll of [1, 3, 6]) {
    const { battle, scene } = await BattleMaps.setUp({ encounter: { ...WOLVES, distanceRoll }, mapId: "fake-isles" });
    const at = (t) => world.rel(scene, t);
    const wolves = scene.tokens.contents.filter((t) => t.actor.type === "NPC");
    const pcs = scene.tokens.contents.filter((t) => t.actor.type === "Player");
    assert.equal(wolves.length, 4);
    assert.ok(wolves.every((t) => at(t).x >= 1500 && at(t).x + 100 <= 1900 && at(t).y >= 400 && at(t).y + 100 <= 1200), `roll ${distanceRoll}: on the far island`);
    assert.ok(pcs.every((t) => at(t).x >= 500 && at(t).x + 100 <= 800 && at(t).y >= 600 && at(t).y + 100 <= 1000), `roll ${distanceRoll}: on the party's island`);
    positions.push(wolves.map((t) => `${at(t).x},${at(t).y}`).sort().join("|"));
    await BattleMaps.returnToTravel(battle.id);
  }
  assert.equal(new Set(positions).size, 1, "the same places for close, near and far: the roll is not asked");
});

test("setUp: a map with no foes zone still puts them where the roll says", async () => {
  seedActors(world);
  const frontWolf = (scene) => Math.min(...scene.tokens.contents.filter((t) => t.actor.type === "NPC").map((t) => world.rel(scene, t).x));
  const near = await BattleMaps.setUp({ encounter: { ...WOLVES, distanceRoll: 3 }, mapId: "fake-lake" });
  const nearFront = frontWolf(near.scene);
  await BattleMaps.returnToTravel(near.battle.id);
  const far = await BattleMaps.setUp({ encounter: { ...WOLVES, distanceRoll: 6 }, mapId: "fake-lake" });
  assert.equal(frontWolf(far.scene) - nearFront, 6 * 100, "far is six squares further than near: 12 against 6");
});

test("setUp: no encounter, or a monster that cannot be loaded, still sets the map up with the party", async () => {
  seedActors(world);
  world.addScene({ id: "hex", name: "Hex map", active: true });
  world.canvasSceneId = "hex";
  const bare = await BattleMaps.setUp({ terrain: "forest" });
  assert.equal(bare.scene.tokens.contents.length, 3);
  assert.deepEqual(bare.battle.encounter, { name: "", uuid: null, count: 0, distanceRoll: null, activityRoll: null, reactionRoll: null, img: null });
  await BattleMaps.returnToTravel(bare.battle.id);

  const missing = await BattleMaps.setUp({ terrain: "forest", encounter: { uuid: "Compendium.gone", name: "Gone", count: 3 } });
  assert.equal(missing.scene.tokens.contents.length, 3);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.noFoe"]);
});

test("setUp: no party selected places nobody, says so, and does not invent one", async () => {
  seedActors(world, { pcs: 0 });
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(scene.tokens.contents.length, 4);
  assert.ok(scene.tokens.contents.every((t) => t.actor.type === "NPC"));
  assert.deepEqual(world.keys("info"), ["SDE.encounterMaps.notify.noPcs"]);
});

test("setUp: a character who already has a token on the scene is not put down twice, is remembered for the combat, and tokens already there are kept off", async () => {
  const { party } = seedActors(world);
  const dungeon = world.addScene({ id: "dungeon", name: "Dungeon", width: 3000, height: 2000 });
  const deployed = world.addToken(dungeon, { actorId: party[0].actor.id, ...world.canvas(dungeon, 1400, 900), flags: {} });
  world.addToken(dungeon, { actorId: "someone-else", ...world.canvas(dungeon, 1500, 900), flags: {} });
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "dungeon" });
  assert.equal(battle.tokenIds.length, 2 + 4, "the two other characters and four wolves");
  assert.ok(!battle.tokenIds.includes(deployed.id), "the deployed one is not the battle's to delete");
  assert.deepEqual(battle.presentTokenIds, [deployed.id], "but it is in the fight");
  const all = dungeon.tokens.contents;
  assert.equal(all.filter((t) => t.actorId === party[0].actor.id).length, 1);
  const cells = all.map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(cells).size, cells.length);
});

test("setUp: another battle on a different scene is not refused, not touched, and warned about once", async () => {
  seedActors(world);
  const first = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const before = structuredClone(first.battle);
  const idsBefore = first.scene.tokens.contents.map((t) => t.id);
  const second = await BattleMaps.setUp({ encounter: WOLVES, terrain: "lake" });
  assert.ok(second);
  assert.notEqual(second.scene, first.scene);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.otherBattle"], "once");
  assert.deepEqual(world.battleOf(first.scene), before, "the first battle's record is as it was");
  assert.deepEqual(first.scene.tokens.contents.map((t) => t.id), idsBefore);
  assert.equal(first.scene.log.filter(([op]) => op === "delete").length, 0, "nothing deleted");
  assert.equal(BattleMaps.current().scene, second.scene, "current() is the newest");
  assert.ok(BattleMaps.get(first.battle.id), "and the older one can still be reached by id");
});

test("setUp: one battle per scene: a second setUp answers with the open one and places nothing, whatever it asked for", async () => {
  seedActors(world);
  const first = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const recordBefore = structuredClone(world.battleOf(first.scene));
  const updatesBefore = first.scene.updates.length;
  world.preload.log.length = 0;
  world.viewed = null;

  // more monsters, and night: neither is applied to a scene that is in the middle of a battle
  const second = await BattleMaps.setUp({ encounter: { ...WOLVES, count: 9 }, terrain: "forest", night: true });
  assert.equal(second.existing, true);
  assert.equal(second.created, false);
  assert.equal(second.scene, first.scene);
  assert.equal(second.map, GROVE);
  assert.deepEqual(second.battle, recordBefore);
  assert.equal(first.scene.tokens.contents.length, 7, "nothing was placed");
  assert.deepEqual(world.battleOf(first.scene), recordBefore, "and the record is as it was");
  assert.equal(first.scene.environment.darknessLevel, 0, "the scene's light is as it was: the battle on it is by day");
  assert.equal(first.scene.updates.length, updatesBefore, "nothing was written to the scene at all");
  assert.deepEqual(world.preload.log, [], "the preload was not started again");
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.alreadyThere"], "told once");
  assert.equal(world.viewed, first.scene.id, "and the GM is taken to it");
  assert.equal(world.sceneCreates.length, 1);

  world.viewed = null;
  await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", view: false });
  assert.equal(world.viewed, null, "view:false is honoured here too");

  // live is open too
  await BattleMaps.bringTable(first.battle.id);
  const third = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(third.existing, true);
  assert.equal(third.battle.status, "live");
  assert.equal(first.scene.tokens.contents.length, 7);
});

test("setUp: one battle per scene holds for a scene the GM brought, and a new battle is fine once the old one has returned", async () => {
  seedActors(world);
  const room = world.addScene({ id: "room", name: "Room" });
  const first = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "room" });
  const again = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "room" });
  assert.equal(again.existing, true);
  assert.equal(again.map, null);
  assert.equal(room.tokens.contents.length, 7);
  await BattleMaps.returnToTravel(first.battle.id);
  const next = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "room" });
  assert.equal(next.existing, undefined);
  assert.notEqual(next.battle.id, first.battle.id);
  assert.equal(room.tokens.contents.length, 7);
});

test("setUp: two calls racing take turns: one battle, and the second is told so", async () => {
  seedActors(world);
  const [a, b] = await Promise.all([
    BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }),
    BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }),
  ]);
  assert.equal(a.existing, undefined);
  assert.equal(b.existing, true);
  assert.equal(a.battle.id, b.battle.id);
  assert.equal(world.sceneCreates.length, 1);
  assert.equal(a.scene.tokens.contents.length, 3 + 4, "the monsters are not placed twice");
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.alreadyThere"]);
});

test("setUp: a record written before presentTokenIds existed is still read", async () => {
  seedActors(world);
  const { scene, battle } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const old = structuredClone(world.battleOf(scene));
  delete old.presentTokenIds;
  scene.flags[MOD][FLAGS.battle] = old;
  assert.deepEqual(BattleMaps.current().battle.presentTokenIds, []);
  assert.deepEqual(BattleMaps.get(battle.id).battle.tokenIds, battle.tokenIds);
  const live = await BattleMaps.bringTable(battle.id);
  assert.equal(live.combat.combatants.length, 7);
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(scene.tokens.contents.length, 0);
});

test("setUp: a flag write that rejects after saving is a write; one a hook vetoed is not, and the tokens just made come down", async () => {
  seedActors(world);
  world.onFlagWrite = () => "throwAfter";
  const saved = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.ok(saved, "the document says it was saved");
  assert.equal(world.battleOf(saved.scene).status, "staged");
  assert.equal(saved.scene.tokens.contents.length, 7);
  await BattleMaps.returnToTravel(saved.battle.id);

  world.onFlagWrite = () => "veto";
  const vetoed = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(vetoed, null);
  const scene = findEncounterScene("fake-grove", GROVE);
  assert.equal(world.battleOf(scene), null);
  assert.equal(scene.tokens.contents.length, 0, "nothing is left that no record owns");
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.saveFailed"));
  assert.deepEqual(world.preload.log.filter(([op]) => op === "start").length, 1, "and the preload did not start for the vetoed one");
});

test("setUp: if the record cannot be written and some of the tokens will not come down either, they are not left unowned", async () => {
  seedActors(world);
  // the first record write is vetoed; the wolves cannot be deleted (a hook says no)
  let writes = 0;
  world.onFlagWrite = (scene, key) => (key === "battle" && writes++ === 0 ? "veto" : null);
  world.vetoDelete = (t) => t.actor.type === "NPC";
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }), null);
  const scene = findEncounterScene("fake-grove", GROVE);
  const wolves = scene.tokens.contents.filter((t) => t.actor.type === "NPC");
  assert.equal(scene.tokens.contents.length, 4, "the party's tokens came down; the wolves would not");
  const record = world.battleOf(scene);
  assert.deepEqual(record.tokenIds.slice().sort(), wolves.map((t) => t.id).sort(), "a record owns exactly the ones left");
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.removeFailed"]);
  assert.match(world.notes.at(-1)[1], /"count":4/);
  // and the GM can take them down once the hook lets go
  world.vetoDelete = () => false;
  const back = await BattleMaps.returnToTravel(record.id);
  assert.ok(back);
  assert.equal(scene.tokens.contents.length, 0);
  assert.equal(world.battleOf(scene), null);
});

test("setUp: if not even a record of the leftovers can be written, the GM is told how many are left and where", async () => {
  seedActors(world);
  world.onFlagWrite = () => "veto";
  world.vetoDelete = (t) => t.actor.type === "NPC";
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }), null);
  const scene = findEncounterScene("fake-grove", GROVE);
  assert.equal(scene.tokens.contents.length, 4);
  assert.equal(world.battleOf(scene), null);
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.strayTokens"]);
  assert.match(world.notes.at(-1)[1], /"count":4/);
});

test("setUp: when the new battle has to be taken down again, a token somebody else just deleted is not in the batch", async () => {
  // v14's batch delete is strict: one id the scene does not have throws, and the whole batch with it
  seedActors(world);
  let once = true;
  world.onFlagWrite = (scene) => {
    if (once) { once = false; scene.tokens.contents.splice(0, 1); }   // another GM deletes one while the record is being written
    return "veto";
  };
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }), null);
  const scene = findEncounterScene("fake-grove", GROVE);
  assert.equal(scene.tokens.contents.length, 0, "the six that were left came down");
  assert.equal(world.deleteCalls.length, 1, "in one clean batch");
  assert.equal(world.deleteCalls[0][1].length, 6, "of the six that were still there");
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.saveFailed"]);
});

test("setUp: a record that comes back from the scene different from what was written is not a saved record", async () => {
  const { party } = seedActors(world);
  const dungeon = world.addScene({ id: "dungeon", name: "Dungeon", width: 3000, height: 2000 });
  world.addToken(dungeon, { actorId: party[0].actor.id, ...world.canvas(dungeon, 1400, 900), flags: {} });
  world.onFlagWrite = () => "mangle";
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, sceneId: "dungeon" }), null);
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.saveFailed"));
  assert.equal(dungeon.tokens.contents.length, 1, "and what it placed came down");
});

test("setUp: tokens that were created and then threw are found on the scene and recorded", async () => {
  seedActors(world);
  world.onCreateTokens = () => "throwAfter";
  const { battle, scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(scene.tokens.contents.length, 7);
  assert.equal(battle.tokenIds.length, 7);
});

test("setUp: tokens that could not be made at all stop the battle before any record is written", async () => {
  seedActors(world);
  world.onCreateTokens = () => "throwBefore";
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }), null);
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.placeFailed"));
  assert.equal(world.battleOf(findEncounterScene("fake-grove", GROVE)), null);
  assert.equal(BattleMaps.current(), null);
});

test("setUp: a part that throws is reported to the GM, not left as an unhandled click", async () => {
  seedActors(world);
  _deps.maps = async () => { throw new Error("encounter-maps.mjs is broken"); };
  assert.equal(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }), null);
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.failed"]);
  // and the queue is not stuck behind it
  _deps.maps = async () => FAKE_LIBRARY;
  assert.ok(await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" }));
});

test("setUp: foes whose prototype token numbers its tokens are numbered one by one, not all (1)", async () => {
  // Actor#getTokenDocument numbers ONE token from the tokens the scene has, so a source made once says "(1)" for every wolf
  seedActors(world, { wolf: { prototypeToken: { appendNumber: true }, sourceName: "Wolf (1)" } });
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const names = scene.tokens.contents.filter((t) => t.actor.type === "NPC").map((t) => t.name).sort();
  assert.deepEqual(names, ["Wolf (1)", "Wolf (2)", "Wolf (3)", "Wolf (4)"]);
  assert.ok(scene.tokens.contents.filter((t) => t.actor.type === "Player").every((t) => /^Hero \d$/.test(t.name)), "the party keeps its names");
});

test("setUp: numbering goes on from the wolves already on the scene, and only for a token that is not linked", async () => {
  const { wolf } = seedActors(world, { wolf: { prototypeToken: { appendNumber: true }, sourceName: "Wolf (1)" } });
  const room = world.addScene({ id: "room", name: "Room" });
  world.addToken(room, { actorId: wolf.id, name: "Wolf (2)", ...world.canvas(room, 100, 100), flags: {} });
  world.addToken(room, { actorId: wolf.id, name: "Wolf", ...world.canvas(room, 100, 200), flags: {} });
  const { battle } = await BattleMaps.setUp({ encounter: { ...WOLVES, count: 3 }, sceneId: "room" });
  const made = room.tokens.contents.filter((t) => battle.tokenIds.includes(t.id) && t.actor.type === "NPC").map((t) => t.name).sort();
  assert.deepEqual(made, ["Wolf (1)", "Wolf (3)", "Wolf (4)"]);

  // a linked prototype keeps one token's name (Foundry does not number those), and one that does not number keeps its own
  world.restore();
  world = makeWorld();
  seedActors(world, { wolf: { prototypeToken: { appendNumber: true }, sourceName: "Wolf", source: { actorLink: true } } });
  const linked = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.deepEqual(linked.scene.tokens.contents.filter((t) => t.actor.type === "NPC").map((t) => t.name), ["Wolf", "Wolf", "Wolf", "Wolf"]);
  await BattleMaps.returnToTravel(linked.battle.id);
  world.restore();
  world = makeWorld();
  seedActors(world);
  const plain = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.deepEqual(plain.scene.tokens.contents.filter((t) => t.actor.type === "NPC").map((t) => t.name), ["Wolf", "Wolf", "Wolf", "Wolf"]);
});

test("setUp: foes whose prototype token picks its picture at random are each dealt one, not all given the same", async () => {
  // Actor#getTokenDocument picks ONE picture for the source, so the four wolves made from it would be four of a kind
  const { wolf } = seedActors(world);
  _deps.foe = async () => ({ actor: wolf, source: sourceFor("Wolf"), images: ["wolf-a.webp", "wolf-b.webp", "wolf-c.webp"] });
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const art = scene.tokens.contents.filter((t) => t.actor.type === "NPC").map((t) => t.texture.src);
  assert.equal(art.length, 4);
  assert.deepEqual(art.slice(0, 3).sort(), ["wolf-a.webp", "wolf-b.webp", "wolf-c.webp"], "every picture is used before one is used again");
  assert.notEqual(art[3], art[2]);
  assert.ok(scene.tokens.contents.filter((t) => t.actor.type === "Player").every((t) => /^Hero \d\.webp$/.test(t.texture.src)), "the party keeps its own art");
});

test("setUp: a prototype token with one picture, or none to choose from, leaves every foe the source's own art", async () => {
  seedActors(world);
  const { scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.deepEqual(scene.tokens.contents.filter((t) => t.actor.type === "NPC").map((t) => t.texture.src), Array(4).fill("Wolf.webp"));
});

// ─── bringTable ──────────────────────────────────────────────────────────────

async function staged() {
  seedActors(world);
  world.addScene({ id: "hex", name: "Hex map", active: true });
  world.canvasSceneId = "hex";
  const answer = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  world.preload.log.length = 0;
  return answer;
}

test("bringTable: activates the scene, makes the combat with noAutoEnroll and enrols the battle's tokens in IT, not started", async () => {
  const { battle, scene } = await staged();
  const elsewhere = await globalThis.Combat.create({ scene: "hex" });
  world.viewedCombat = elsewhere;   // the combat the GM happens to be viewing: createCombatants would use it if not handed ours
  const answer = await BattleMaps.bringTable(battle.id);
  assert.deepEqual(world.activated, [scene.id]);
  assert.equal(world.scenes.get("hex").active, false, "the table moved");
  assert.equal(scene.active, true);
  const { combat } = answer;
  assert.deepEqual(combat.flags, { [MOD]: { noAutoEnroll: true, [FLAGS.battle]: battle.id } }, "tagged with the battle from the moment it is made");
  assert.equal(combat.scene, scene.id);
  assert.equal(combat.started, false);
  assert.equal(combat.round, 0);
  assert.deepEqual(combat.combatants.map((c) => c.tokenId).sort(), battle.tokenIds.slice().sort());
  assert.equal(elsewhere.combatants.length, 0, "the other combat got nobody");
  const stored = world.battleOf(scene);
  assert.equal(stored.status, "live");
  assert.equal(stored.combatId, combat.id);
  assert.deepEqual(stored.tokenIds, battle.tokenIds);
  assert.deepEqual(answer.battle, stored);
  assert.deepEqual(world.preload.log, [["stop", scene.id]], "the readout is over: the table is on the map");
  assert.deepEqual(scene.updates.map((u) => u.keys), [[`flags.${MOD}.battle`], [`flags.${MOD}.battle`]], "setUp's write and this one, both through the one flag");
});

test("bringTable: pressed twice it makes one combat and enrols nobody twice; a token added since is enrolled", async () => {
  const { battle, scene } = await staged();
  const first = await BattleMaps.bringTable(battle.id);
  world.addToken(scene, { actorId: "wolf", ...world.canvas(scene, 100, 100), flags: { [MOD]: { [FLAGS.token]: battle.id } } });
  assert.equal((await BattleMaps.bringTable(battle.id)).combat, first.combat, "the same combat");
  assert.equal(world.combatList.length, 1);
  assert.equal(first.combat.combatants.length, 7, "the stray token is not in the record, so it is not ours to enrol");
  assert.equal(world.activated.length, 1, "and the scene is not activated again");
  // a token that IS in the record but missed the first enrolment gets in on the second press
  first.combat.combatants.pop();
  const missing = battle.tokenIds.at(-1);
  await BattleMaps.bringTable(battle.id);
  assert.ok(first.combat.combatants.some((c) => c.tokenId === missing));
  assert.equal(first.combat.combatants.length, 7);
});

// The system lights a torch on the actor's prototype token and on the token it finds on the canvas being looked at. A torch lit
// on the hex map while the battle was staged reached the actor and none of the battle's tokens.
const TORCH = { dim: 30, bright: 5 };
/** `dim/bright` of each token of a scene by name; the foes share a name, so they come back as a list. */
const lightsOf = (scene, type) => scene.tokens.contents.filter((t) => !type || t.actor.type === type).map((t) => [t.name, `${t.light.dim}/${t.light.bright}`]);
const heroLight = (scene, actor) => lightsOf(scene, "Player").find(([name]) => name === actor.name)[1];

test("bringTable: a torch lit after the battle was staged lights the party's tokens as the table comes", async () => {
  const { party, wolf } = seedActors(world);
  world.addScene({ id: "hex", name: "Hex map", active: true });
  world.canvasSceneId = "hex";
  const { battle, scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.deepEqual(lightsOf(scene).map(([, light]) => light), Array(7).fill("0/0"), "staged in the dark");
  wolf.prototypeToken.light = { dim: 10, bright: 2 };   // a monster's prototype is not the party's torch: never copied
  for (const { actor } of party) actor.prototypeToken.light = { ...TORCH };   // the players light up while still on the hex map
  await BattleMaps.bringTable(battle.id);
  for (const { actor } of party) assert.equal(heroLight(scene, actor), "30/5", `${actor.name} has the torch the actor holds`);
  assert.deepEqual(lightsOf(scene, "NPC").map(([, light]) => light), Array(4).fill("0/0"), "the foes are as they were");
  assert.equal(scene.log.filter(([op]) => op === "update").length, 1, "one write for the three of them");
});

test("bringTable: a torch put out after the battle was staged is out when the table comes", async () => {
  const { party } = seedActors(world);
  for (const { actor, source } of party) { actor.prototypeToken.light = { ...TORCH }; source.light = { ...TORCH }; }   // lit when the battle was set up
  const { battle, scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  assert.equal(heroLight(scene, party[0].actor), "30/5", "the battle's tokens were made lit");
  party[1].actor.prototypeToken.light = { dim: 0, bright: 0 };
  await BattleMaps.bringTable(battle.id);
  assert.deepEqual(party.map(({ actor }) => heroLight(scene, actor)), ["30/5", "0/0", "30/5"]);
});

test("bringTable: a party whose light already matches is not written to, and a character already on the scene keeps the GM's light", async () => {
  const { party } = seedActors(world);
  const dungeon = world.addScene({ id: "dungeon", name: "Dungeon", width: 3000, height: 2000 });
  const mine = world.addToken(dungeon, { actorId: party[0].actor.id, ...world.canvas(dungeon, 1400, 900), light: { dim: 60, bright: 15 }, flags: {} });
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "dungeon" });
  party[0].actor.prototypeToken.light = { ...TORCH };   // the actor's light changes, the GM's own token is not the battle's to touch
  await BattleMaps.bringTable(battle.id);
  assert.deepEqual(mine.light, { dim: 60, bright: 15 }, "a character who was on the scene already");
  assert.equal(dungeon.log.filter(([op]) => op === "update").length, 0, "and nothing else differed, so nothing was written");
});

test("bringTable: a light that cannot be refreshed is logged and the table still comes", async () => {
  const { party } = seedActors(world);
  const { battle, scene } = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  for (const { actor } of party) actor.prototypeToken.light = { ...TORCH };
  world.failTokenUpdate = true;
  const answer = await BattleMaps.bringTable(battle.id);
  assert.ok(answer?.combat, "the combat was made");
  assert.equal(world.battleOf(scene).status, "live");
  assert.equal(heroLight(scene, party[0].actor), "0/0", "the old light stays");
});

test("bringTable: the characters who were on the scene already are in the combat too, though this battle placed no token for them", async () => {
  const { party } = seedActors(world);
  const dungeon = world.addScene({ id: "dungeon", name: "Dungeon", width: 3000, height: 2000 });
  const deployed = world.addToken(dungeon, { actorId: party[0].actor.id, ...world.canvas(dungeon, 1400, 900), flags: {} });
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "dungeon" });
  const { combat } = await BattleMaps.bringTable(battle.id);
  assert.deepEqual(
    combat.combatants.map((c) => c.tokenId).sort(),
    [...battle.tokenIds, deployed.id].sort(),
    "the crawl strip's own enrolment is off (noAutoEnroll), so nobody else would have put the deployed character in",
  );
  // pressing it again adds nobody a second time
  await BattleMaps.bringTable(battle.id);
  assert.equal(combat.combatants.length, 7);
  // and Return leaves that character's token where it is
  await BattleMaps.returnToTravel(battle.id);
  assert.deepEqual(dungeon.tokens.contents, [deployed]);
});

test("bringTable: a scene that is already active is left alone", async () => {
  const { battle, scene } = await staged();
  scene.active = true;
  await BattleMaps.bringTable(battle.id);
  assert.deepEqual(world.activated, []);
  assert.equal(world.battleOf(scene).status, "live");
});

test("bringTable: if the scene will not activate there is no combat and the battle stays staged", async () => {
  const { battle, scene } = await staged();
  world.activateWorks = false;
  assert.equal(await BattleMaps.bringTable(battle.id), null);
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.activateFailed"]);
  assert.equal(world.combatList.length, 0);
  assert.equal(world.battleOf(scene).status, "staged");
});

test("bringTable: a record write that does not stick takes its new combat away again, by its id", async () => {
  const { battle, scene } = await staged();
  const other = await globalThis.Combat.create({ scene: "elsewhere" });
  world.onFlagWrite = () => "veto";
  assert.equal(await BattleMaps.bringTable(battle.id), null);
  assert.deepEqual(world.combatList, [other], "only the combat this created is gone");
  assert.equal(world.battleOf(scene).status, "staged");
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.saveFailed"));
});

test("bringTable: a record write that rejects after saving is a live battle", async () => {
  const { battle, scene } = await staged();
  world.onFlagWrite = () => "throwAfter";
  const answer = await BattleMaps.bringTable(battle.id);
  assert.ok(answer);
  assert.equal(world.battleOf(scene).status, "live");
  assert.equal(world.combatList.length, 1);
});

test("bringTable: a combat whose create rejected after saving is found by its tag and used, not made again", async () => {
  const { battle, scene } = await staged();
  world.combatCreate = "throwAfter";
  const answer = await BattleMaps.bringTable(battle.id);
  assert.ok(answer, "the create threw, but the combat is in the world");
  assert.equal(world.combatList.length, 1);
  assert.equal(answer.combat, world.combatList[0]);
  assert.equal(world.battleOf(scene).combatId, answer.combat.id, "and the record knows it");
  assert.equal(answer.combat.combatants.length, 7);
  assert.deepEqual(world.keys("error"), []);
});

test("bringTable: a combat whose create did not happen at all is told", async () => {
  const { battle, scene } = await staged();
  world.combatCreate = "throwBefore";
  assert.equal(await BattleMaps.bringTable(battle.id), null);
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.combatFailed"]);
  assert.equal(world.battleOf(scene).status, "staged");
});

test("bringTable: a combat that was saved but never recorded is ended by its tag when the record will not take it", async () => {
  const { battle, scene } = await staged();
  const other = await globalThis.Combat.create({ scene: "elsewhere", flags: { [MOD]: { [FLAGS.battle]: "somebody-elses" } } });
  world.combatCreate = "throwAfter";
  world.onFlagWrite = () => "veto";
  assert.equal(await BattleMaps.bringTable(battle.id), null);
  assert.deepEqual(world.combatList, [other], "the tagged one is gone, another battle's is not");
  assert.equal(world.battleOf(scene).combatId, null);
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.saveFailed"));
});

test("bringTable: a combat left from an earlier try (tagged, not recorded) is taken up instead of a second being made", async () => {
  const { battle, scene } = await staged();
  const left = await globalThis.Combat.create({ scene: scene.id, flags: { [MOD]: { noAutoEnroll: true, [FLAGS.battle]: battle.id } } });
  const answer = await BattleMaps.bringTable(battle.id);
  assert.equal(answer.combat, left);
  assert.equal(world.combatList.length, 1);
  assert.equal(world.battleOf(scene).combatId, left.id);
});

test("bringTable: an unknown battle is told so", async () => {
  await staged();
  assert.equal(await BattleMaps.bringTable("nope"), null);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.noBattle"]);
});

// ─── returnToTravel ──────────────────────────────────────────────────────────

test("returnToTravel: takes down exactly this battle's tokens, ends its combat, clears the record, puts the table back", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  const combatId = world.battleOf(scene).combatId;
  // three tokens that are NOT this battle's, however they look
  const gm = world.addToken(scene, { actorId: "gm-thing", ...world.canvas(scene, 300, 400), flags: {} });
  const strayWithFlag = world.addToken(scene, { actorId: "wolf", ...world.canvas(scene, 400, 400), flags: { [MOD]: { [FLAGS.token]: battle.id } } });
  const otherBattle = world.addToken(scene, { actorId: "wolf", ...world.canvas(scene, 500, 400), flags: { [MOD]: { [FLAGS.token]: "somebody-elses" } } });
  world.preload.log.length = 0;
  world.log = [];

  const back = await BattleMaps.returnToTravel(battle.id);
  assert.deepEqual(scene.tokens.contents, [gm, strayWithFlag, otherBattle], "only the seven the record lists are gone");
  const deleteCalls = scene.log.filter(([op]) => op === "delete");
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0].slice(1).sort(), battle.tokenIds.slice().sort(), "the exact ids, nothing computed from a count or a sweep");
  assert.equal(world.combatList.find((c) => c.id === combatId), undefined, "the combat is gone");
  assert.equal(world.battleOf(scene), null, "the record is cleared");
  assert.equal(scene.flags[MOD][FLAGS.scene], "fake-grove", "and the map's flag beside it is not");
  assert.deepEqual(world.activated.slice(-1), ["hex"], "the origin scene is active again");
  assert.equal(world.scenes.get("hex").active, true);
  assert.equal(back.battle.status, "done");
  assert.equal(back.saved, null);
  assert.deepEqual(world.preload.log, [["stop", scene.id]]);
  assert.equal(BattleMaps.current(), null);
  assert.equal(BattleMaps.get(battle.id), null);
});

test("returnToTravel: the combat ends BEFORE the tokens come down, so what reads it as it ends still finds the monsters", async () => {
  // Foundry leaves a scene-tied combat's combatants in place when their tokens go, and a combatant with no token reads as
  // its base actor at full health, never defeated: Hunter XP, loot drops and the session recap all read the combat as it ends.
  const { battle, scene } = await staged();
  const { combat } = await BattleMaps.bringTable(battle.id);
  const seen = [];
  world.onDeleteCombat = (ended) => {
    assert.equal(ended, combat);
    for (const c of ended.combatants) seen.push(scene.tokens.has(c.tokenId));
  };
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(seen.length, 7);
  assert.ok(seen.every(Boolean), "every combatant still had its token when the combat ended");
  assert.equal(scene.tokens.contents.length, 0, "and the tokens did come down, after");
});

test("returnToTravel: a combat that cannot be ended stops everything: no token comes down, the record stays, the GM is told", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  world.vetoCombatDelete = true;
  assert.equal(await BattleMaps.returnToTravel(battle.id), null);
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.combatStays"]);
  assert.equal(scene.tokens.contents.length, 7);
  assert.equal(world.battleOf(scene).status, "live");
  assert.equal(world.combatList.length, 1);
  assert.deepEqual(world.activated, [scene.id], "the table stays where it is");
  world.vetoCombatDelete = false;
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(scene.tokens.contents.length, 0);
});

test("returnToTravel: a combat the record never heard of, but that carries the battle's tag, is ended too", async () => {
  const { battle, scene } = await staged();
  await globalThis.Combat.create({ scene: scene.id, flags: { [MOD]: { [FLAGS.battle]: battle.id } } });
  const another = await globalThis.Combat.create({ scene: scene.id, flags: { [MOD]: { [FLAGS.battle]: "somebody-elses" } } });
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.deepEqual(world.combatList, [another]);
});

test("returnToTravel: a token that will not come down keeps the battle alive, listing exactly it, and the table stays", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  const stubborn = scene.tokens.contents.find((t) => t.actor.type === "NPC");
  world.vetoDelete = (t) => t.id === stubborn.id;
  assert.equal(await BattleMaps.returnToTravel(battle.id), null);
  assert.deepEqual(scene.tokens.contents, [stubborn]);
  const record = world.battleOf(scene);
  assert.deepEqual(record.tokenIds, [stubborn.id], "exactly the one left");
  assert.equal(record.combatId, null, "the combat did end");
  assert.equal(record.status, "live");
  assert.equal(world.combatList.length, 0);
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.removeFailed"]);
  assert.match(world.notes.at(-1)[1], /"count":1/);
  assert.deepEqual(world.activated, [scene.id], "the origin scene was not activated: the battle is not over");
  assert.equal(BattleMaps.current().battle.id, battle.id);

  // once the hook lets go, Return finishes the job
  world.vetoDelete = () => false;
  const back = await BattleMaps.returnToTravel(battle.id);
  assert.equal(back.battle.status, "done");
  assert.equal(scene.tokens.contents.length, 0);
  assert.equal(world.battleOf(scene), null);
  assert.deepEqual(world.activated, [scene.id, "hex"]);
});

test("returnToTravel: a token somebody else already deleted does not strand the rest of the batch", async () => {
  const { battle, scene } = await staged();
  const gone = scene.tokens.contents[2];
  scene.tokens.contents.splice(2, 1);
  const back = await BattleMaps.returnToTravel(battle.id);
  assert.ok(back);
  assert.equal(scene.tokens.contents.length, 0, "the six that were still there came down");
  assert.equal(world.battleOf(scene), null);
  assert.ok(world.deleteCalls.every(([, ids]) => !ids.includes(gone.id)), "and the id that was gone was never sent");
  assert.deepEqual(world.keys("error"), []);
});

test("returnToTravel: a batch the server refuses is retried one token at a time", async () => {
  const { battle, scene } = await staged();
  world.failBatchDelete = true;
  const back = await BattleMaps.returnToTravel(battle.id);
  assert.ok(back);
  assert.equal(scene.tokens.contents.length, 0);
  assert.equal(world.battleOf(scene), null);
  const sizes = world.deleteCalls.map(([, ids]) => ids.length);
  assert.deepEqual(sizes, [7, 1, 1, 1, 1, 1, 1, 1], "the whole batch once, then each token on its own");
});

test("returnToTravel: a delete that throws after it has deleted is still a delete", async () => {
  const { battle, scene } = await staged();
  world.deleteThrowsAfter = true;
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(scene.tokens.contents.length, 0);
  assert.equal(world.deleteCalls.length, 1, "nothing was left to retry");
  assert.equal(world.battleOf(scene), null);
});

test("returnToTravel: a staged battle that never moved the table only returns the GM's view", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.returnToTravel(battle.id);
  assert.equal(world.viewed, "hex");
  assert.deepEqual(world.activated, [], "the table never left the hex map, so nothing is activated");
  assert.equal(scene.tokens.contents.length, 0);
  assert.equal(world.battleOf(scene), null);
});

test("returnToTravel: a combat that is already gone, or a record with none, is fine", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  world.combatList.length = 0;
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(world.battleOf(scene), null);
});

test("returnToTravel: an origin scene that no longer exists is told, and the record is still cleared", async () => {
  const { battle, scene } = await staged();
  world.scenes.contents.splice(world.scenes.contents.findIndex((s) => s.id === "hex"), 1);
  await BattleMaps.bringTable(battle.id);
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.originMissing"]);
  assert.equal(world.battleOf(scene), null);
  assert.equal(scene.tokens.contents.length, 0);
});

test("returnToTravel: the origin's own scene (battle on the scene they were on) has nothing to activate", async () => {
  seedActors(world);
  const room = world.addScene({ id: "room", name: "Room", active: true });
  world.canvasSceneId = "room";
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "room" });
  await BattleMaps.returnToTravel(battle.id);
  assert.deepEqual(world.activated, []);
  assert.equal(room.tokens.contents.length, 0);
});

test("returnToTravel: Keep copies a library scene first, tokens and all, and only then takes the tokens down", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  world.log = [];
  const realClone = scene.clone.bind(scene);
  scene.clone = async (...args) => { const copy = await realClone(...args); world.log.push(`copy has ${copy.tokens.contents.length} tokens`); return copy; };
  const removed = scene.deleteEmbeddedDocuments.bind(scene);
  scene.deleteEmbeddedDocuments = async (...args) => { world.log.push("delete"); return removed(...args); };

  const back = await BattleMaps.returnToTravel(battle.id, { keep: true, label: "4 Wolf (Fake grove)" });
  assert.deepEqual(world.log, ["clone", "copy has 7 tokens", "delete"]);
  assert.equal(back.saved.name, "4 Wolf (Fake grove)");
  assert.equal(back.saved.flags[MOD][FLAGS.saved].mapId, "fake-grove");
  assert.equal(scene.tokens.contents.length, 0, "the library scene is clean for the next battle");
  assert.equal(back.saved.tokens.contents.length, 7, "the copy keeps them");
  assert.equal(world.battleOf(scene), null);
  assert.equal(world.battleOf(back.saved), null, "the copy carries no battle record");
});

test("returnToTravel: Keep with no label names the copy for the encounter", async () => {
  const { battle } = await staged();
  await BattleMaps.returnToTravel(battle.id, { keep: true });
  assert.equal(world.cloneCalls[0].createData.name, "Wolf");
});

test("returnToTravel: if Keep cannot copy, nothing is taken down", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  world.cloneFails = true;
  assert.equal(await BattleMaps.returnToTravel(battle.id, { keep: true }), null);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.keepFailed"]);
  assert.equal(scene.tokens.contents.length, 7);
  assert.equal(world.battleOf(scene).status, "live");
  assert.equal(world.combatList.length, 1);
  assert.deepEqual(world.activated, [scene.id], "and the table stays on the battle map");
  // the GM can press Return again without Keep
  world.cloneFails = false;
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(scene.tokens.contents.length, 0);

  // a copy that throws is the same as one that fails
  const again = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const throwing = again.scene;
  throwing.clone = async () => { throw new Error("thumbnail upload denied"); };
  assert.equal(await BattleMaps.returnToTravel(again.battle.id, { keep: true }), null);
  assert.equal(throwing.tokens.contents.length, 7);
});

test("returnToTravel: a Keep that cannot copy leaves a staged battle's preload readout running", async () => {
  const { battle, scene } = await staged();
  world.cloneFails = true;
  assert.equal(await BattleMaps.returnToTravel(battle.id, { keep: true }), null);
  assert.deepEqual(world.preload.log, [], "nothing was stopped: the battle is still there");
  assert.equal(scene.tokens.contents.length, 7);
  world.cloneFails = false;
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.deepEqual(world.preload.log, [["stop", scene.id]]);
});

test("returnToTravel: Keep on a scene the GM brought leaves its tokens and makes no copy", async () => {
  seedActors(world);
  const room = world.addScene({ id: "room", name: "Room" });
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "room" });
  const ids = battle.tokenIds.slice();
  const back = await BattleMaps.returnToTravel(battle.id, { keep: true, label: "ignored" });
  assert.equal(world.cloneCalls.length, 0);
  assert.equal(back.saved, null);
  assert.deepEqual(room.tokens.contents.map((t) => t.id).sort(), ids.sort(), "the tokens stay on their scene");
  assert.equal(world.battleOf(room), null, "but the battle is over");
  assert.equal(room.log.filter(([op]) => op === "delete").length, 0);
});

test("returnToTravel: a world scene without Keep loses only this battle's tokens", async () => {
  seedActors(world);
  const room = world.addScene({ id: "room", name: "Room" });
  const mine = world.addToken(room, { actorId: "gm", ...world.canvas(room, 900, 900), flags: {} });
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "room" });
  await BattleMaps.returnToTravel(battle.id);
  assert.deepEqual(room.tokens.contents, [mine]);
});

test("returnToTravel: a clear that does not stick is told, and a clear that rejects after saving is a clear", async () => {
  const { battle, scene } = await staged();
  world.onFlagWrite = () => "throwAfter";
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(world.battleOf(scene), null);
  assert.deepEqual(world.keys("error"), []);

  const second = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  world.onFlagWrite = () => "veto";
  assert.ok(await BattleMaps.returnToTravel(second.battle.id));
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.saveFailed"));
  assert.equal(world.battleOf(scene).id, second.battle.id, "the record is still there for the GM to try again");
  assert.equal(scene.tokens.contents.length, 0);
});

test("returnToTravel: a second call for the same battle finds nothing to do", async () => {
  const { battle } = await staged();
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(await BattleMaps.returnToTravel(battle.id), null);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.noBattle"]);
});

// ─── changeMap ───────────────────────────────────────────────────────────────

test("changeMap: the battle's own tokens move to the new map, laid out for it; the old ones come down by id; the record moves", async () => {
  const { battle, scene: grove } = await staged();
  const stray = world.addToken(grove, { actorId: "gm-thing", ...world.canvas(grove, 700, 700), flags: {} });
  const oldIds = battle.tokenIds.slice();
  world.preload.log.length = 0;
  world.viewed = null;

  const answer = await BattleMaps.changeMap(battle.id, { mapId: "fake-lake" });
  const lake = answer.scene;
  assert.equal(lake.name, "Encounter: Fake lake");
  assert.equal(answer.map, LAKE);
  assert.equal(answer.created, true);
  assert.equal(lake.tokens.contents.length, 7);
  assert.equal(answer.battle.id, battle.id, "the same battle");
  assert.equal(answer.battle.sceneId, lake.id);
  assert.equal(answer.battle.mapId, "fake-lake");
  assert.deepEqual(answer.battle.tokenIds.slice().sort(), lake.tokens.contents.map((t) => t.id).sort());
  assert.deepEqual(world.battleOf(lake), answer.battle);
  assert.equal(answer.battle.status, "staged");
  assert.equal(answer.battle.originSceneId, "hex", "still goes home to the hex map");
  assert.deepEqual(answer.battle.encounter, battle.encounter);

  // moved, not copied and left behind: the old ones are gone by exact id, the GM's own token is still there
  assert.deepEqual(grove.tokens.contents, [stray]);
  assert.deepEqual(grove.log.filter(([op]) => op === "delete").map((c) => c.slice(1).sort()), [oldIds.slice().sort()]);
  assert.equal(world.battleOf(grove), null, "the old scene no longer holds a battle");
  assert.equal(grove.flags[MOD][FLAGS.scene], "fake-grove");

  // the new ones: this battle's, on the lake's level, laid out for the deck and the water
  for (const t of lake.tokens.contents) {
    assert.equal(t.flags[MOD][FLAGS.token], battle.id);
    assert.equal(t.level, `level-${lake.id}`);
    assert.equal(t.flags["some-module"].keep, true, "the token's own data came along");
    assert.ok(t.x % 100 === 0 && t.y % 100 === 0, "on the grid");
  }
  const at = (t) => world.rel(lake, t);
  const pcs = lake.tokens.contents.filter((t) => t.actor.type === "Player");
  const wolves = lake.tokens.contents.filter((t) => t.actor.type === "NPC");
  assert.ok(pcs.every((t) => at(t).x >= 1700 && at(t).x + 100 <= 2700));
  assert.equal(Math.min(...wolves.map((t) => at(t).x)) - Math.max(...pcs.map((t) => at(t).x + 100)), 5 * 100, "the distance rolled is kept: near, 5 empty squares");
  assert.equal(world.viewed, lake.id);
  assert.deepEqual(world.preload.log, [["stop", grove.id], ["start", lake.id, 7]], "the old readout ends, the new one starts once the tokens are there");
  assert.equal(BattleMaps.current().scene, lake);
  assert.equal(world.activated.length, 0, "no one is moved by changing the map");
});

test("changeMap: onto a map that names its foes zone, they go there", async () => {
  const { battle } = await staged();
  const answer = await BattleMaps.changeMap(battle.id, { mapId: "fake-isles" });
  const at = (t) => world.rel(answer.scene, t);
  const wolves = answer.scene.tokens.contents.filter((t) => t.actor.type === "NPC");
  assert.equal(wolves.length, 4);
  assert.ok(wolves.every((t) => at(t).x >= 1500 && at(t).x + 100 <= 1900 && at(t).y >= 400 && at(t).y + 100 <= 1200));
});

test("changeMap: takes the picker's answer: a world scene, a variant, night", async () => {
  const { battle } = await staged();
  const room = world.addScene({ id: "room", name: "Room", width: 2000, height: 2000 });
  const toRoom = await BattleMaps.changeMap(battle.id, { sceneId: "room", mapId: null, variant: null, night: false, camping: false });
  assert.equal(toRoom.scene, room);
  assert.equal(toRoom.map, null);
  assert.equal(toRoom.battle.mapId, null);
  assert.equal(room.tokens.contents.length, 7);

  const toCamp = await BattleMaps.changeMap(battle.id, { mapId: "fake-grove", variant: "camp", night: true });
  assert.equal(toCamp.map, GROVE_CAMP);
  assert.equal(toCamp.battle.variant, "camp");
  assert.equal(toCamp.scene.environment.darknessLevel, NIGHT_DARKNESS);
  assert.equal(room.tokens.contents.length, 0, "and the world scene's battle tokens came down off it");
});

test("changeMap: the look the battle has carries over unless another is chosen", async () => {
  seedActors(world);
  const night = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", night: true });
  assert.equal(night.scene.environment.darknessLevel, NIGHT_DARKNESS);
  const lake = await BattleMaps.changeMap(night.battle.id, { mapId: "fake-lake" });
  assert.equal(lake.scene.environment.darknessLevel, NIGHT_DARKNESS, "still night");
  assert.equal(lake.battle.variant, "night");
});

test("changeMap: only while staged", async () => {
  const { battle, scene } = await staged();
  await BattleMaps.bringTable(battle.id);
  assert.equal(await BattleMaps.changeMap(battle.id, { mapId: "fake-lake" }), null);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.notStaged"]);
  assert.equal(scene.tokens.contents.length, 7);
  assert.equal(world.sceneCreates.length, 1, "no scene was made for it");
});

test("changeMap: the same map again, or an unknown one, changes nothing", async () => {
  const { battle, scene } = await staged();
  const updatesBefore = scene.updates.length;
  const same = await BattleMaps.changeMap(battle.id, { mapId: "fake-grove" });
  assert.equal(same.scene, scene);
  assert.equal(scene.tokens.contents.length, 7);
  assert.equal(scene.log.filter(([op]) => op === "delete").length, 0);
  assert.equal(scene.updates.length, updatesBefore, "not a write");
  assert.equal(await BattleMaps.changeMap(battle.id, { mapId: "no-such-map" }), null);
  assert.equal(await BattleMaps.changeMap("nope", { mapId: "fake-lake" }), null);
  assert.deepEqual(world.keys("warn"), ["SDE.encounterMaps.notify.unknownMap", "SDE.encounterMaps.notify.noBattle"]);
  assert.equal(world.battleOf(scene).status, "staged");
});

test("changeMap: the same map in another look changes the light and the record's variant, and moves nothing", async () => {
  const { battle, scene } = await staged();   // the grove by day
  const ids = scene.tokens.contents.map((t) => t.id);

  const night = await BattleMaps.changeMap(battle.id, { mapId: "fake-grove", variant: "night" });
  assert.equal(night.scene, scene);
  assert.equal(scene.environment.darknessLevel, NIGHT_DARKNESS);
  assert.equal(night.battle.variant, "night");
  assert.equal(world.battleOf(scene).variant, "night", "the record says so too, or the next Change map would start from day");
  assert.deepEqual(scene.tokens.contents.map((t) => t.id), ids, "nothing moved");
  assert.equal(scene.log.filter(([op]) => op === "delete").length, 0);

  const day = await BattleMaps.changeMap(battle.id, { mapId: "fake-grove", variant: "day" });
  assert.equal(day.battle.variant, "day");
  assert.equal(scene.environment.darknessLevel, 0);

  const updates = scene.updates.length;
  await BattleMaps.changeMap(battle.id, { mapId: "fake-grove", variant: "day" });
  assert.equal(scene.updates.length, updates, "the same look again is not a write");
});

test("changeMap: a camp by day to a camp by night is the same variant name, but the light still changes", async () => {
  seedActors(world);
  const camp = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest", camping: true });
  assert.equal(camp.battle.variant, "camp");
  assert.equal(camp.scene.environment.darknessLevel, 0);
  const recordWrites = camp.scene.updates.length;
  const dusk = await BattleMaps.changeMap(camp.battle.id, { mapId: "fake-grove", variant: "camp", night: true });
  assert.equal(dusk.scene, camp.scene);
  assert.equal(camp.scene.environment.darknessLevel, NIGHT_DARKNESS);
  assert.equal(dusk.battle.variant, "camp");
  assert.equal(camp.scene.updates.length, recordWrites + 1, "the light only: the record had nothing to change");
  assert.equal(camp.scene.tokens.contents.length, 7);
});

test("changeMap: a scene that already holds a battle is refused, before its lighting is touched", async () => {
  const { battle, scene } = await staged();
  const other = await BattleMaps.setUp({ encounter: WOLVES, terrain: "lake" });
  const updates = other.scene.updates.length;
  assert.equal(await BattleMaps.changeMap(battle.id, { mapId: "fake-lake", night: true }), null);
  assert.ok(world.keys("warn").includes("SDE.encounterMaps.notify.sceneBusy"));
  assert.equal(scene.tokens.contents.length, 7, "nothing moved");
  assert.equal(other.scene.tokens.contents.length, 7);
  assert.equal(other.scene.environment.darknessLevel, 0, "the lake is by day for the battle on it, and a refused change leaves it so");
  assert.equal(other.scene.updates.length, updates, "not written at all");
});

test("changeMap: if the new record does not stick, the old battle is exactly as it was", async () => {
  const { battle, scene } = await staged();
  const before = structuredClone(world.battleOf(scene));
  const ids = scene.tokens.contents.map((t) => t.id);
  world.onFlagWrite = (target) => (target.id === scene.id ? null : "veto");
  assert.equal(await BattleMaps.changeMap(battle.id, { mapId: "fake-lake" }), null);
  const lake = findEncounterScene("fake-lake", LAKE);
  assert.equal(lake.tokens.contents.length, 0, "the tokens made on the new scene are taken down again");
  assert.deepEqual(world.battleOf(scene), before);
  assert.deepEqual(scene.tokens.contents.map((t) => t.id), ids);
  assert.ok(world.keys("error").includes("SDE.encounterMaps.notify.saveFailed"));
});

test("changeMap: old tokens that will not come down leave a record of exactly them on the old scene, and the new scene answers to the id", async () => {
  const { battle, scene: grove } = await staged();
  const stubborn = grove.tokens.contents.filter((t) => t.actor.type === "NPC").slice(0, 2);
  world.vetoDelete = (t) => stubborn.some((s) => s.id === t.id);
  const answer = await BattleMaps.changeMap(battle.id, { mapId: "fake-lake" });
  const lake = answer.scene;
  assert.ok(answer, "the move itself worked");
  assert.equal(lake.tokens.contents.length, 7);
  assert.deepEqual(grove.tokens.contents, stubborn);
  const leftover = world.battleOf(grove);
  assert.equal(leftover.id, battle.id);
  assert.deepEqual(leftover.tokenIds.slice().sort(), stubborn.map((t) => t.id).sort(), "exactly the ones left");
  assert.deepEqual(leftover.presentTokenIds, []);
  assert.ok(leftover.at < world.battleOf(lake).at, "older, so the new scene's record is the battle");
  assert.deepEqual(world.keys("error"), ["SDE.encounterMaps.notify.removeFailed"]);
  assert.equal(BattleMaps.get(battle.id).scene, lake);
  assert.equal(BattleMaps.current().scene, lake);

  // Return takes down the new scene's battle, and what is left of it on the old one is still there to be returned
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(lake.tokens.contents.length, 0);
  assert.equal(BattleMaps.current().scene, grove);
  world.vetoDelete = () => false;
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(grove.tokens.contents.length, 0);
  assert.equal(BattleMaps.current(), null);
});

test("changeMap: a token the GM pasted from a battle token, already on the new scene, is not taken for the battle's own", async () => {
  const { battle, scene: grove } = await staged();
  const { scene: lake } = await ensureEncounterScene(LAKE);
  const pasted = world.addToken(lake, { actorId: "wolf", ...world.canvas(lake, 100, 100), flags: { [MOD]: { [FLAGS.token]: battle.id } } });
  const answer = await BattleMaps.changeMap(battle.id, { mapId: "fake-lake" });
  assert.equal(answer.scene, lake);
  assert.equal(answer.battle.tokenIds.length, 7);
  assert.ok(!answer.battle.tokenIds.includes(pasted.id), "it was there before; the battle did not make it");
  assert.equal(grove.tokens.contents.length, 0);
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.deepEqual(lake.tokens.contents, [pasted], "and Return does not delete it");
});

test("changeMap: a character who already has a token on the new scene is not given a second", async () => {
  const { battle } = await staged();
  const pcActor = world.actors.get("pc2");
  const room = world.addScene({ id: "room", name: "Room", width: 3000, height: 2000 });
  const there = world.addToken(room, { actorId: pcActor.id, ...world.canvas(room, 800, 800), flags: {} });
  const answer = await BattleMaps.changeMap(battle.id, { sceneId: "room" });
  assert.equal(room.tokens.contents.filter((t) => t.actorId === pcActor.id).length, 1);
  assert.equal(answer.battle.tokenIds.length, 2 + 4);
  assert.deepEqual(answer.battle.presentTokenIds, [there.id], "she is in the fight, and not the battle's to delete");
  const { combat } = await BattleMaps.bringTable(battle.id);
  assert.ok(combat.combatants.some((c) => c.tokenId === there.id));
  assert.equal(combat.combatants.length, 7);
  await BattleMaps.returnToTravel(battle.id);
  assert.deepEqual(room.tokens.contents, [there]);
});

test("changeMap: the characters who were on the old scene already come along, as the battle's own tokens on the new one", async () => {
  const { party } = seedActors(world);
  const dungeon = world.addScene({ id: "dungeon", name: "Dungeon", width: 3000, height: 2000 });
  const deployed = world.addToken(dungeon, { actorId: party[0].actor.id, ...world.canvas(dungeon, 1400, 900), flags: {} });
  const { battle } = await BattleMaps.setUp({ encounter: WOLVES, sceneId: "dungeon" });
  assert.deepEqual(battle.presentTokenIds, [deployed.id]);
  const answer = await BattleMaps.changeMap(battle.id, { mapId: "fake-lake" });
  const lake = answer.scene;
  assert.equal(lake.tokens.contents.filter((t) => t.actor.type === "Player").length, 3, "all three characters are on the lake");
  assert.equal(answer.battle.tokenIds.length, 3 + 4);
  assert.deepEqual(answer.battle.presentTokenIds, []);
  assert.deepEqual(dungeon.tokens.contents, [deployed], "the deployed character's own token is still on the dungeon, and the rest came down");
  assert.ok(await BattleMaps.returnToTravel(battle.id));
  assert.equal(lake.tokens.contents.length, 0);
  assert.deepEqual(dungeon.tokens.contents, [deployed]);
});

// ─── the defaults that read Foundry ──────────────────────────────────────────

test("the real party loader: the selected party's characters, linked; nothing when there is no party", async () => {
  Object.assign(_deps, { party: REAL_DEPS.party });
  const hero = (n) => world.addActor({
    id: `h${n}`, type: "Player", name: `Hero ${n}`, img: `h${n}.webp`, system: { isPC: true }, prototypeToken: { texture: { src: `h${n}.webp` } },
    async getTokenDocument() { return { toObject: () => sourceFor(`Hero ${n}`) }; },
  });
  const [a, b] = [hero(1), hero(2)];
  const hireling = world.addActor({ id: "hire", type: "NPC", name: "Hireling", system: { isPC: false } });
  assert.deepEqual(await _deps.party(), [], "no party yet");
  world.addActor({
    id: "party", type: "NPC", name: "The party", flags: { [MOD]: { party: true, partyData: { version: 1, members: [a.uuid, b.uuid, hireling.uuid], leaderUuid: a.uuid, followLeader: true, formation: { slots: [] } } } },
  });
  const loaded = await _deps.party();
  assert.deepEqual(loaded.map((p) => p.actor), [a, b], "characters only, not the hireling");
  assert.ok(loaded.every((p) => p.link === true));
  assert.equal(loaded[0].source.name, "Hero 1");
});

test("the real foe loader: a world actor from a uuid with its token source; null for anything else", async () => {
  Object.assign(_deps, { foe: REAL_DEPS.foe });
  const wolf = world.addActor({
    id: "wolf", type: "NPC", name: "Wolf", img: "wolf.webp", prototypeToken: { texture: { src: "wolf.webp" } },
    async getTokenDocument() { return { toObject: () => sourceFor("Wolf") }; },
  });
  wolf.documentName = "Actor";
  globalThis.fromUuid = async (uuid) => (uuid === "Actor.wolf" ? wolf : uuid === "JournalEntry.x" ? { documentName: "JournalEntry" } : null);
  const loaded = await _deps.foe("Actor.wolf");
  assert.equal(loaded.actor, wolf);
  assert.equal(loaded.source.name, "Wolf");
  assert.equal(await _deps.foe("JournalEntry.x"), null);
  assert.equal(await _deps.foe("Actor.gone"), null);
  globalThis.fromUuid = async () => { throw new Error("bad uuid"); };
  assert.equal(await _deps.foe("garbage"), null);
});

test("the real foe loader: a wildcard prototype token's pictures are listed; one picture, or a list that cannot be had, lists none", async () => {
  Object.assign(_deps, { foe: REAL_DEPS.foe });
  const asked = [];
  const creature = (id, prototypeToken, images) => {
    const actor = world.addActor({
      id, type: "NPC", name: id, img: `${id}.webp`, prototypeToken: { texture: { src: `${id}.webp` }, ...prototypeToken },
      async getTokenDocument() { return { toObject: () => sourceFor(id) }; },
      async getTokenImages() { asked.push(id); return images(); },
    });
    actor.documentName = "Actor";
    return actor;
  };
  const byUuid = {
    "Actor.wolf": creature("wolf", { randomImg: true }, () => ["wolf-1.webp", "wolf-2.webp"]),
    "Actor.bear": creature("bear", {}, () => ["bear.webp"]),
    "Actor.boar": creature("boar", { randomImg: true }, () => { throw new Error("no wildcard answer"); }),
  };
  globalThis.fromUuid = async (uuid) => byUuid[uuid] ?? null;
  assert.deepEqual((await _deps.foe("Actor.wolf")).images, ["wolf-1.webp", "wolf-2.webp"]);
  assert.deepEqual((await _deps.foe("Actor.bear")).images, []);
  const boar = await _deps.foe("Actor.boar");
  assert.deepEqual(boar.images, [], "a list that cannot be had is no list, and the foe still loads");
  assert.equal(boar.source.name, "boar");
  assert.deepEqual(asked, ["wolf", "boar"], "a prototype with one picture is not asked for a list");
});

// ─── against the real library ────────────────────────────────────────────────

test("with the real library and scene builder: forest opens the shipped default, the party inside its zone, the foes on the map", async () => {
  seedActors(world);
  Object.assign(_deps, { maps: REAL_DEPS.maps });
  const answer = await BattleMaps.setUp({ encounter: WOLVES, terrain: "forest" });
  const forest = ENCOUNTER_MAPS.find((m) => m.terrains.includes("forest") && m.variant === "day");
  assert.equal(answer.map, forest);
  assert.equal(answer.scene.name, encounterSceneName(forest));
  assert.equal(world.sceneCreates[0].levels[0].background.src, forest.image);
  for (const t of answer.scene.tokens.contents) {
    const { x, y } = world.rel(answer.scene, t);
    assert.ok(x >= 0 && y >= 0 && x + 100 <= forest.width && y + 100 <= forest.height, "on the map");
  }

  // every shipped map: a battle can be laid out on it, and the camp ones light a fire
  await BattleMaps.returnToTravel(answer.battle.id);
  for (const map of ENCOUNTER_MAPS) {
    const terrain = map.terrains[0];
    const { battle, scene } = await BattleMaps.setUp({ encounter: { ...WOLVES, count: 12 }, mapId: map.id, terrain, camping: map.variant === "camp", view: false });
    assert.equal(scene.tokens.contents.length, 15, map.id);
    const cells = scene.tokens.contents.map((t) => `${t.x},${t.y}`);
    assert.equal(new Set(cells).size, cells.length, `${map.id}: nobody on anybody`);
    for (const t of scene.tokens.contents) {
      const { x, y } = world.rel(scene, t);
      assert.ok(x >= 0 && y >= 0 && x + 100 <= map.width && y + 100 <= map.height, `${map.id}: on the map`);
    }
    if (Array.isArray(map.foes)) {
      const inFoes = scene.tokens.contents.filter((t) => {
        if (t.actor.type !== "NPC") return false;
        const { x, y } = world.rel(scene, t);
        return x >= map.foes[0] && y >= map.foes[1] && x + 100 <= map.foes[2] && y + 100 <= map.foes[3];
      });
      assert.ok(inFoes.length > 0, `${map.id}: names a foes zone, and the foes are in it`);
    }
    assert.equal(scene.lights.length, map.campLight ? 1 : 0, map.id);
    assert.equal(scene.environment.globalLight.enabled, true, `${map.id}: lit by day`);
    await BattleMaps.returnToTravel(battle.id);
    assert.equal(scene.tokens.contents.length, 0, map.id);
  }
});

// ─── strings ─────────────────────────────────────────────────────────────────

test("every notification and name this part shows is in en.json, with the placeholders its call passes", () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
  const en = JSON.parse(read("../languages/en.json"));
  const used = new Set();
  for (const file of ["../scripts/encounter/battle-maps/encounter-battle.mjs", "../scripts/encounter/battle-maps/encounter-scene.mjs"]) {
    for (const [, key] of read(file).matchAll(/"(SDE\.encounterMaps\.[A-Za-z.]+)"/g)) used.add(key);
  }
  assert.ok(used.size > 0, "found the keys this part asks for");
  for (const key of used) {
    const text = en[key];
    assert.ok(typeof text === "string" && text.trim() === text && text.length > 0, key);
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(text), `${key}: no emoji`);
  }
  // every placeholder a call passes is one the text has
  assert.match(en["SDE.encounterMaps.notify.otherBattle"], /\{scene\}/);
  assert.match(en["SDE.encounterMaps.notify.alreadyThere"], /\{scene\}/);
  assert.match(en["SDE.encounterMaps.notify.removeFailed"], /\{count\}.*\{scene\}|\{scene\}.*\{count\}/);
  assert.match(en["SDE.encounterMaps.notify.strayTokens"], /\{count\}.*\{scene\}|\{scene\}.*\{count\}/);
  assert.match(en["SDE.encounterMaps.notify.unknownMap"], /\{id\}/);
  assert.match(en["SDE.encounterMaps.notify.noFoe"], /\{name\}/);
  assert.match(en["SDE.encounterMaps.scene.savedName"], /\{scene\}/);
});
