import test from "node:test";
import assert from "node:assert/strict";
import { replaceModuleFlag } from "../scripts/shared/module-flags.mjs";

const MOD = "shadowdark-enhancer";

/**
 * A document standing in for Foundry's update semantics, to the extent this
 * helper depends on them: a dotted path writes into nested objects, a `-=key`
 * deletes, and a plain object value MERGES into what is there. That merge is
 * why a flag has to be deleted before it is set, and the sibling flag here is
 * the 4768 hex tags that a `recursive: false` write destroyed on 2026-09-18.
 */
function fakeDoc(flags = {}) {
  const doc = { flags: structuredClone(flags), updates: 0 };
  doc.update = async (data) => {
    doc.updates++;
    for (const [path, value] of Object.entries(data)) {
      const parts = path.split(".");
      const leaf = parts.pop();
      let node = doc.flags;
      for (const p of parts.slice(1)) node = node[p] ??= {};   // parts[0] is "flags"
      if (leaf.startsWith("-=")) delete node[leaf.slice(2)];
      else if (value && typeof value === "object" && node[leaf] && typeof node[leaf] === "object") {
        node[leaf] = { ...node[leaf], ...value };
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

test("replaceModuleFlag: it takes two updates — a delete and a set in one would merge", async () => {
  const doc = fakeDoc({ [MOD]: { hexTags: { cells: { 1: "forest" } } } });
  await replaceModuleFlag(doc, "hexTags", { cells: { 2: "swamp" } });
  assert.equal(doc.updates, 2);
});
