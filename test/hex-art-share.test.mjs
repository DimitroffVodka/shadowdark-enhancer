import test from "node:test";
import assert from "node:assert/strict";

// Shared tags across a print and its drawn copies (hex-art.mjs shareTags), against a fake server with latency:
// a client's document changes when the server's answer comes back, and an update that changes nothing fires no hook.
const MOD = "shadowdark-enhancer";
const DEL = Symbol("del");
globalThis._replace = (value) => ({ replace: value });
globalThis._del = DEL;
const hooks = {};
globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn), once: () => {}, callAll: () => {} };
globalThis.CONFIG = { Canvas: { managedScenes: {} } };
const { registerHexArt, buildDrawnMap } = await import("../scripts/hex-map/hex-art.mjs");

const tags = (cells) => ({ origin: { num: "0101" }, cells });

/**
 * Runs `script(write)` against a print and `copies` drawn copies: write(t, sceneId, key, value) writes one module flag
 * at time t (undefined deletes it). Returns each scene's stored module flags once the scenes stop writing.
 */
async function simulate({ copies, latency = 40, script }) {
  hooks.updateScene = [];
  const timers = [], all = [];
  let now = 0;
  const at = (t, fn) => timers.push({ t, fn });
  const scene = (id, source) => {
    const s = {
      id, name: id, flags: { [MOD]: { hexTags: tags({}), ...(source ? { hexArtSource: source } : {}) } },
      update(data, options = {}) {
        const writes = Object.entries(data).map(([path, raw]) => [path.split(".").pop(), raw === DEL ? undefined : structuredClone(raw.replace)]);
        return new Promise((resolve) => at(now + latency, () => {
          const changed = writes.filter(([key, value]) => JSON.stringify(s.server[key]) !== JSON.stringify(value));
          for (const [key, value] of changed) s.server[key] = value;
          at(now + latency, () => {
            if (changed.length) {
              for (const [key, value] of changed) s.flags[MOD][key] = structuredClone(value);
              const touched = Object.fromEntries(changed.map(([key]) => [key, {}]));
              for (const hook of hooks.updateScene) hook(s, { flags: { [MOD]: touched } }, options);
            }
            resolve(s);
          });
        }));
      },
    };
    s.server = structuredClone(s.flags[MOD]);
    all.push(s);
    return s;
  };
  scene("print");
  for (let k = 1; k <= copies; k++) scene(`copy${k}`, "print");
  globalThis.game = {
    users: { activeGM: { isSelf: true } }, user: { isGM: true },
    scenes: { get: (id) => all.find((s) => s.id === id), filter: (fn) => all.filter(fn), forEach: (fn) => all.forEach(fn) },
  };
  registerHexArt();
  script((t, id, key, value) => at(t, () => all.find((s) => s.id === id).update({ [`flags.${MOD}.${key}`]: value === undefined ? DEL : globalThis._replace(value) })));
  let steps = 0;
  while (timers.length && steps++ < 5000) {
    timers.sort((a, b) => a.t - b.t);
    const { t, fn } = timers.shift();
    now = t;
    fn();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(steps < 5000, "the scenes never stopped writing to each other");
  return Object.fromEntries(all.map((s) => [s.id, s.server]));
}
const cellsOf = (result) => Object.fromEntries(Object.entries(result).map(([id, f]) => [id, f.hexTags ? Object.keys(f.hexTags.cells).join(",") : null]));

test("two quick brush strokes on a print land on the print and every copy", async () => {
  for (const copies of [1, 2, 3]) {
    for (const gap of [20, 60, 150, 400]) {
      const result = cellsOf(await simulate({ copies, script: (write) => {
        write(0, "print", "hexTags", tags({ 101: "forest|gm" }));
        write(gap, "print", "hexTags", tags({ 101: "forest|gm", 102: "swamp|gm" }));
      } }));
      for (const [id, cells] of Object.entries(result)) assert.equal(cells, "101,102", `${copies} copies, ${gap} ms: ${id}`);
    }
  }
});

test("clearing the print's tags clears them on its copies too", async () => {
  const result = cellsOf(await simulate({ copies: 2, script: (write) => {
    write(0, "print", "hexTags", tags({ 101: "forest|gm" }));
    write(500, "print", "hexTags", undefined);
  } }));
  assert.deepEqual(result, { print: null, copy1: null, copy2: null });
});

test("keyed art and region fixes given on a copy reach the print and the other copies; the tags are left alone", async () => {
  const result = await simulate({ copies: 2, script: (write) => {
    write(0, "copy1", "hexArt", { 101: { art: "a.webp" } });
    write(10, "copy2", "hexRegions", { fixes: [1] });
  } });
  for (const id of ["print", "copy1", "copy2"]) {
    assert.deepEqual(result[id].hexArt, { 101: { art: "a.webp" } }, id);
    assert.deepEqual(result[id].hexRegions, { fixes: [1] }, id);
    assert.deepEqual(result[id].hexTags, tags({}), id);
  }
});

test("a drawn copy keeps other packages' flags and the print's fog setting, but not Extras' or the print's records", async () => {
  const flags = {
    core: { legacyHex: true }, "some-module": { x: 1 }, "shadowdark-extras": { hexScene: true },
    [MOD]: { hexTags: tags({ 101: "forest|gm" }), hexFog: { enabled: false }, hexRecords: { a: 1 }, hexTile: { 101: "pick" } },
  };
  const print = { id: "print", name: "Print", flags, toObject: () => structuredClone({ _id: "print", name: "Print", flags, tokens: [], tiles: [] }) };
  let created;
  globalThis.Scene = { create: async (data) => (created = data) };
  globalThis.game = {
    user: { isGM: true }, i18n: { format: (_key, { name, n }) => `${name} ${n}` },
    scenes: { get: (id) => (id === "print" ? print : undefined), filter: () => [] },
  };
  await buildDrawnMap(print);
  assert.deepEqual(created.flags.core, { legacyHex: true });
  assert.deepEqual(created.flags["some-module"], { x: 1 });
  assert.equal(created.flags["shadowdark-extras"], undefined);
  const own = created.flags[MOD];
  assert.deepEqual(own.hexFog, { enabled: false });
  assert.equal(own.hexArtSource, "print");
  assert.equal(own.hexRecords, undefined);
  assert.equal(own.hexTile, undefined);
});
