/**
 * A7 public API contract.
 *
 * The entry point is Foundry-bound and cannot be imported in a Node process,
 * so the nested surface is checked from its source (the same approach as the
 * existing docs/API contract). The return values are exercised through the
 * pure resolver/planner and the adapter-injected reconciler.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { LOOT_MATCH, resolveLootItem } from "../scripts/loot/loot-resolution.mjs";
import {
  generatedItemId, planGeneratedItems, reconcileGeneratedItems,
} from "../scripts/shared/generated-items.mjs";
import { MANAGED_ITEMS_PACK } from "../scripts/shared/art-provenance.mjs";

const ENTRY = new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url);
const readEntry = () => readFile(ENTRY, "utf8");

/** Brace-match an object literal; the entry point's API is one source object. */
function objectAt(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

function nestedApiObjects(source) {
  const apiStart = source.indexOf("game.shadowdarkEnhancer = {");
  assert.ok(apiStart > -1, "the public API object is missing");
  const api = objectAt(source, source.indexOf("{", apiStart));
  const lootStart = api.indexOf("\n    loot: {");
  assert.ok(lootStart > -1, "the loot namespace is missing");
  const loot = objectAt(api, api.indexOf("{", lootStart));
  const generatedStart = loot.indexOf("generated: {");
  assert.ok(generatedStart > -1, "the generated loot namespace is missing");
  return { api, loot, generated: objectAt(loot, loot.indexOf("{", generatedStart)) };
}

const definition = (name = "Carved Bone") => ({
  name,
  type: "Basic",
  img: "icons/commodities/bones/bone-carved-brown.webp",
  system: { description: `<p>${name}</p>` },
});

describe("A7 public API — nested surface", () => {
  test("bumps the additive API minor and nests resolver/generated operations", async () => {
    const { api, loot, generated } = nestedApiObjects(await readEntry());
    assert.match(api, /apiVersion:\s*["']1\.4\.0["']/);
    assert.match(loot, /resolve:\s*async\s*\(/);
    assert.match(generated, /identity:\s*\(/);
    assert.match(generated, /plan:\s*async\s*\(desired,\s*\{\s*source\s*=\s*""/);
    assert.match(generated, /reconcile:\s*async\s*\(desired,\s*\{\s*source\s*=\s*""/);
  });

  test("public generated writes retain the GM guard and managed-pack lookup", async () => {
    const { generated } = nestedApiObjects(await readEntry());
    assert.match(generated, /if\s*\(!game\.user\?\.isGM\)/);
    assert.match(generated, /findSuitePack\("sde-items"\)/);
    assert.match(generated, /ensureLootPack\(\)/);
  });
});

describe("A7 public API — return shapes", () => {
  test("identity is synchronous, source-qualified, and blank-safe", () => {
    const id = generatedItemId("CS1", "Carved Bone");
    assert.equal(typeof id, "string");
    assert.match(id, /^fnv1a32:[0-9a-f]{8}$/);
    assert.equal(generatedItemId("", "Carved Bone"), "");
    assert.equal(generatedItemId("CS1", "   "), "");
  });

  test("loot.resolve's result shape distinguishes exact, ambiguous, and unresolved", () => {
    const exact = resolveLootItem("Axe (5 gp)", [{ uuid: "u1", name: "Axe" }]);
    assert.deepEqual(Object.keys(exact).sort(), ["matched", "name", "query", "status", "uuid"]);
    assert.equal(exact.status, LOOT_MATCH.EXACT);

    const ambiguous = resolveLootItem("Rope", [
      { uuid: "u1", name: "Rope" }, { uuid: "u2", name: "Rope" },
    ]);
    assert.deepEqual(Object.keys(ambiguous).sort(), ["candidates", "query", "status"]);
    assert.equal(ambiguous.status, LOOT_MATCH.AMBIGUOUS);

    const unresolved = resolveLootItem("A bottle of Murgazi wine", [
      { uuid: "u1", name: "Bottle" },
    ]);
    assert.deepEqual(Object.keys(unresolved).sort(), ["query", "status"]);
    assert.equal(unresolved.status, LOOT_MATCH.UNRESOLVED);
  });

  test("generated.plan is pure and returns the complete decision shape", () => {
    const out = planGeneratedItems({
      desired: [definition()], existing: [], packCollection: MANAGED_ITEMS_PACK, source: "CS1",
    });
    assert.deepEqual(
      Object.keys(out).sort(),
      ["boundary", "create", "pack", "refused", "unchanged", "update"],
    );
    assert.deepEqual(Object.keys(out.create[0]).sort(), ["id", "name", "payload"]);
    assert.equal(out.update.length, 0);
  });

  test("generated.reconcile reports writes, refusals, and adapter failures", async () => {
    const out = await reconcileGeneratedItems(
      { collection: MANAGED_ITEMS_PACK, getDocuments: async () => [] },
      [definition()],
      { source: "CS1", adapter: { createItem: async () => null, notify: () => {} } },
    );
    assert.deepEqual(
      Object.keys(out).sort(),
      ["created", "failures", "plan", "refused", "unchanged", "updated"],
    );
    assert.equal(out.created, 0);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].reason, "create-failed");
  });
});
