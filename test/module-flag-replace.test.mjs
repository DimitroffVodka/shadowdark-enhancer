import test from "node:test";
import assert from "node:assert/strict";
import { replaceModuleFlag } from "../scripts/shared/module-flags.mjs";

const MOD = "shadowdark-enhancer";
// Foundry 14's forced-replacement operator, a global in the client.
class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);

/** Foundry's update merge is recursive (mergeObject); a shallow one would hide a plain set. */
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") deepMerge(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}

/**
 * A document standing in for Foundry's update semantics, to the extent this
 * helper depends on them: a dotted path writes into nested objects, `_replace`
 * replaces the key whole, and a plain object value MERGES into what is there.
 * That merge is why a flag can't simply be set, and the sibling flag here is
 * the 4768 hex tags that a `recursive: false` write destroyed on 2026-09-18.
 */
function fakeDoc(flags = {}) {
  const doc = { flags: structuredClone(flags), updates: 0, paths: [], writes: [] };
  doc.update = async (data) => {
    doc.updates++;
    for (const [path, value] of Object.entries(data)) {
      doc.paths.push(path);
      doc.writes.push(value);
      const parts = path.split(".");
      const leaf = parts.pop();
      let node = doc.flags;
      for (const p of parts.slice(1)) node = node[p] ??= {};   // parts[0] is "flags"
      if (value instanceof Replacement) node[leaf] = structuredClone(value.value);
      else if (value && typeof value === "object" && node[leaf] && typeof node[leaf] === "object") {
        node[leaf] = deepMerge(node[leaf], value);
      } else node[leaf] = value;
    }
    return doc;
  };
  return doc;
}

test("replaceModuleFlag: replaces its own key and leaves the module's other flags alone", async () => {
  const doc = fakeDoc({ [MOD]: { hexTags: { cells: { 1: "forest", 2: "swamp" } }, hexTagFixes: { seen: { 14: "1/2" } } } });
  await replaceModuleFlag(doc, "hexTagFixes", { seen: { 21: "3/9" } });
  assert.deepEqual(doc.flags[MOD].hexTags, { cells: { 1: "forest", 2: "swamp" } }, "the tags beside it must survive");
  assert.deepEqual(doc.flags[MOD].hexTagFixes, { seen: { 21: "3/9" } }, "and the written key is replaced, not merged");
});

test("replaceModuleFlag: a key removed from the value does not survive in the database", async () => {
  const doc = fakeDoc({ [MOD]: { hexTags: { cells: { 1: "forest", 2: "swamp" } } } });
  await replaceModuleFlag(doc, "hexTags", { cells: { 1: "forest" } });
  assert.deepEqual(doc.flags[MOD].hexTags.cells, { 1: "forest" }, "a cleared cell must be gone, which is why setFlag is not enough");
});

test("replaceModuleFlag: other packages' flags are never touched", async () => {
  const doc = fakeDoc({ [MOD]: { hexTags: { cells: {} } }, "shadowdark-extras": { hexData: { ours: true } } });
  await replaceModuleFlag(doc, "hexTags", { cells: { 9: "lava" } });
  assert.deepEqual(doc.flags["shadowdark-extras"], { hexData: { ours: true } });
});

test("replaceModuleFlag: one update, a _replace, so no client ever sees the flag missing (#274)", async () => {
  const doc = fakeDoc({ [MOD]: { hexTags: { cells: { 1: "forest" } } } });
  await replaceModuleFlag(doc, "hexTags", { cells: { 2: "swamp" } });
  assert.equal(doc.updates, 1);
  assert.ok(doc.writes[0] instanceof Replacement, "a plain set would merge into the old value");
});

test("replaceModuleFlag: writes the key's own path, never a legacy -=key or ==key (#261)", async () => {
  const doc = fakeDoc({ [MOD]: { quest: { status: "active" } } });
  await replaceModuleFlag(doc, "quest", { status: "completed" });
  assert.deepEqual(doc.paths, [`flags.${MOD}.quest`]);
  assert.deepEqual(doc.flags[MOD].quest, { status: "completed" });
});
