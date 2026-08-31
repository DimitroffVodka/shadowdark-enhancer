/**
 * A8 (#93) — an ordinary Item import must not eat a generated Monster Spell.
 *
 * A1 moved the generated library into the shared managed Items pack, so an
 * ordinary item whose name matches a generated spell now lands on the same
 * index. Three independent failures made that collision destructive, and all
 * three are pinned here:
 *
 *   1. `createItem` honoured "Replace Existing" against a generated Monster
 *      Spell, so the library document was overwritten by parser output.
 *   2. `replaceDocument` updates with `recursive: false`, which replaces the
 *      whole `flags` object — erasing `monsterSpell.libraryId`, the only handle
 *      the planner has on that document. The next refresh then created a
 *      DUPLICATE instead of matching the original.
 *   3. The importer's Spell path falls back to `<p>{name}</p>` when a paste
 *      brings no prose. `preservedDescription` read that as real prose, so the
 *      fallback won over curated text.
 *
 * Layers: pure classification, the pure flag-preservation rule, the shared
 * replace seam, the Foundry-bound entry point, and the planner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { preservedDescription, withPropertyNote } from "../scripts/shared/property-note.mjs";
import {
  isGeneratedMonsterSpell,
  monsterSpellProvenance,
  preservedModuleFlags,
} from "../scripts/shared/module-flags.mjs";
import { replaceDocument } from "../scripts/shared/compendium-suite.mjs";
import { createItem, createItems, preserveCuratedFields, buildItemData } from "../scripts/importer/items/item-importer.mjs";
import {
  collectMonsterSpells,
  materializeMonsterSpell,
  planMonsterSpellRefresh,
} from "../scripts/monster-creator/monster-spell-library-core.mjs";

const CURATED_TEXT = "<p>My own 3d6 version, DC 13.</p>";
const CURATED_ART = "worlds/abletodestroy/art/hand-picked-fireball.webp";

// ─── 1. The `<p>{name}</p>` fallback is not prose ────────────────────────────

test("curated prose survives an incoming description that only echoes the name", () => {
  const kept = preservedDescription(CURATED_TEXT, "<p>Fireball - Goblin Shaman</p>", {
    name: "Fireball - Goblin Shaman",
  });
  assert.equal(kept, CURATED_TEXT);
});

test("the name echo is recognized however the importer spelled it", () => {
  for (const incoming of [
    "<p>Fireball</p>",
    "  <p>  Fireball  </p>  ",
    "<p>fireball</p>",
    "Fireball",
  ]) {
    assert.equal(
      preservedDescription(CURATED_TEXT, incoming, { name: "Fireball" }),
      CURATED_TEXT,
      `"${incoming}" should read as importer fallback`,
    );
  }
});

test("a stored name echo is fallback too, so a real paste replaces it", () => {
  const fresh = "<p>A gout of flame fills a near cube.</p>";
  assert.equal(preservedDescription("<p>Fireball</p>", fresh, { name: "Fireball" }), null);
});

test("prose that merely mentions the name is still prose", () => {
  const incoming = "<p>Fireball deals 3d6 damage.</p>";
  assert.equal(preservedDescription(CURATED_TEXT, incoming, { name: "Fireball" }), null);
});

test("the name echo does not swallow a multi-paragraph description", () => {
  const incoming = "<p>Fireball</p><p>Deals 3d6 damage.</p>";
  assert.equal(preservedDescription(CURATED_TEXT, incoming, { name: "Fireball" }), null);
});

test("without a name the classification is exactly what it was before", () => {
  // Back-compat: the option is additive. `<p>Fireball</p>` with no name to
  // compare against is ordinary prose and still wins.
  assert.equal(preservedDescription(CURATED_TEXT, "<p>Fireball</p>"), null);
  assert.equal(preservedDescription(CURATED_TEXT, "<p></p>"), CURATED_TEXT);
});

test("the property note still rides across a name-echo re-import", () => {
  const stored = withPropertyNote(CURATED_TEXT, ["Obsidian"]);
  const kept = preservedDescription(stored, "<p>Lance</p>", { name: "Lance" });
  assert.equal(kept, stored, "curated text keeps its stale note byte for byte");

  const incoming = withPropertyNote("<p>Lance</p>", ["Charge"]);
  const merged = preservedDescription(stored, incoming, { name: "Lance" });
  assert.ok(merged.startsWith(CURATED_TEXT), "curated prose leads");
  assert.ok(merged.includes("Charge"), "the fresh note replaces the stale one");
  assert.equal(merged.includes("Obsidian"), false);
});

// ─── 2. Module-owned flag blocks survive a wholesale replacement ─────────────

const monsterSpellFlags = (extra = {}) => ({
  [MODULE_ID]: {
    monsterSpell: { generated: true, libraryId: "lib-fireball", originalName: "Fireball" },
    ...extra,
  },
});

test("a replacement payload that says nothing about a module block keeps it", () => {
  const merged = preservedModuleFlags(
    { [MODULE_ID]: { imported: true, source: "wr" } },
    monsterSpellFlags(),
  );
  assert.deepEqual(merged[MODULE_ID].monsterSpell, {
    generated: true, libraryId: "lib-fireball", originalName: "Fireball",
  });
  assert.equal(merged[MODULE_ID].imported, true);
  assert.equal(merged[MODULE_ID].source, "wr");
});

test("the payload is authoritative for the blocks it does declare", () => {
  const merged = preservedModuleFlags(
    { [MODULE_ID]: { art: { state: "default", img: "b.webp" } } },
    { [MODULE_ID]: { art: { state: "custom", img: "a.webp" }, monsterSpell: { generated: true } } },
  );
  assert.deepEqual(merged[MODULE_ID].art, { state: "default", img: "b.webp" });
  assert.deepEqual(merged[MODULE_ID].monsterSpell, { generated: true });
});

test("nothing is invented when there is nothing to rescue", () => {
  assert.equal(preservedModuleFlags(undefined, monsterSpellFlags()), null,
    "a payload with no flags at all leaves the stored flags untouched");
  assert.equal(preservedModuleFlags({ [MODULE_ID]: { imported: true } }, {}), null);
  assert.equal(preservedModuleFlags({ [MODULE_ID]: { imported: true } }, undefined), null);
});

test("a payload that drops our namespace entirely still keeps the module block", () => {
  const merged = preservedModuleFlags({ "shadowdark-extras": { alignment: "chaotic" } }, monsterSpellFlags());
  assert.deepEqual(merged[MODULE_ID], monsterSpellFlags()[MODULE_ID]);
  assert.deepEqual(merged["shadowdark-extras"], { alignment: "chaotic" });
});

test("the generated-Monster-Spell marker is read structurally", () => {
  assert.equal(isGeneratedMonsterSpell({ flags: monsterSpellFlags() }), true);
  assert.equal(isGeneratedMonsterSpell({ flags: { [MODULE_ID]: { monsterSpell: { generated: false } } } }), false);
  assert.equal(isGeneratedMonsterSpell({ flags: { [MODULE_ID]: { generated: true } } }), false,
    "the A7/D6 replace-always marker is a different contract");
  assert.equal(isGeneratedMonsterSpell({}), false);
  assert.equal(isGeneratedMonsterSpell(null), false);
  assert.equal(monsterSpellProvenance({ flags: monsterSpellFlags() })?.libraryId, "lib-fireball");
  assert.equal(monsterSpellProvenance({}), null);
});

// ─── 3. The shared replace seam ──────────────────────────────────────────────

class FakeItem {
  static created = [];
  static createResult = "ok";

  constructor(data) { Object.assign(this, data); }

  static async create(payload, options) {
    FakeItem.created.push({ payload, options });
    if (FakeItem.createResult === null) return null;
    return new FakeItem({ ...payload, uuid: "Compendium.world.sde-items.Item.new" });
  }

  get documentName() { return "Item"; }
  getEmbeddedCollection() { return this.effects ?? []; }
  async deleteEmbeddedDocuments() {}
  async createEmbeddedDocuments(_name, rows) { this.effects = rows; }
  async update(data, options) {
    this.updateCalls = (this.updateCalls ?? []).concat([{ data, options }]);
    if (this.updateFails) throw new Error("validation failed");
    Object.assign(this, data);
    return this;
  }
  async delete() { this.deleted = true; }
}

function storedSpell(overrides = {}) {
  return new FakeItem({
    _id: "doc-1",
    name: "Fireball - Goblin Shaman",
    type: "Spell",
    img: CURATED_ART,
    uuid: "Compendium.world.sde-items.Item.doc-1",
    effects: [],
    system: { description: CURATED_TEXT, tier: 3, properties: ["Compendium.x.Item.KEPT"] },
    flags: monsterSpellFlags(),
    ...overrides,
  });
}

const fakePack = { collection: "world.shadowdark-enhancer--items" };

test("an in-place replacement keeps the module block the payload never mentioned", async () => {
  const old = storedSpell();
  const { doc, mode } = await replaceDocument(
    old,
    { name: "Fireball - Goblin Shaman", type: "Spell", system: { description: "<p>x</p>" },
      flags: { [MODULE_ID]: { imported: true, source: "wr" } } },
    fakePack,
  );

  assert.equal(mode, "updated");
  assert.equal(doc, old, "the UUID survives — this is an update, not a recreate");
  const written = old.updateCalls[0].data.flags;
  assert.equal(old.updateCalls[0].options.recursive, false, "still the wholesale update");
  assert.deepEqual(written[MODULE_ID].monsterSpell, monsterSpellFlags()[MODULE_ID].monsterSpell);
  assert.equal(written[MODULE_ID].imported, true);
});

test("the create-then-delete fallback carries the module block too", async () => {
  FakeItem.created = [];
  const old = storedSpell({ updateFails: true });
  const { mode } = await replaceDocument(
    old,
    { name: "Fireball - Goblin Shaman", type: "Spell", flags: { [MODULE_ID]: { imported: true } } },
    fakePack,
  );

  assert.equal(mode, "recreated");
  assert.equal(FakeItem.created.length, 1);
  assert.deepEqual(
    FakeItem.created[0].payload.flags[MODULE_ID].monsterSpell,
    monsterSpellFlags()[MODULE_ID].monsterSpell,
  );
});

test("a payload with no flags at all leaves the stored flags alone", async () => {
  const old = storedSpell();
  await replaceDocument(old, { name: "Fireball - Goblin Shaman", type: "Spell" }, fakePack);
  assert.equal("flags" in old.updateCalls[0].data, false,
    "no flags key means the update never touches flags");
});

// ─── 4. The Foundry-bound entry point ────────────────────────────────────────

function fakeWorld({ documents = [] } = {}) {
  const notifications = { warn: [], info: [], error: [] };
  const created = [];
  const docs = documents;

  const pack = {
    collection: "world.shadowdark-enhancer--items",
    documentName: "Item",
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Items" },
    locked: false,
    folders: [],
    async getIndex() { return docs.map((d) => ({ _id: d._id, name: d.name, type: d.type })); },
    async getDocument(id) { return docs.find((d) => d._id === id) ?? null; },
  };

  const saved = new Map();
  for (const key of ["game", "ui", "Item", "Folder"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  globalThis.game = { user: { isGM: true }, packs: [pack] };
  globalThis.ui = {
    notifications: {
      warn: (m) => notifications.warn.push(m),
      info: (m) => notifications.info.push(m),
      error: (m) => notifications.error.push(m),
    },
  };
  globalThis.Item = {
    async create(data, options) {
      const doc = { ...data, _id: `new-${created.length + 1}`, uuid: `Compendium.${options.pack}.Item.new-${created.length + 1}` };
      created.push(doc);
      docs.push(doc);
      return doc;
    },
  };
  globalThis.Folder = { async create(data) { return { id: "folder-1", name: data.name, folder: null }; } };

  return {
    pack, docs, created, notifications,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("an ordinary import that says Replace never replaces a generated Monster Spell", async () => {
  const spell = storedSpell();
  const world = fakeWorld({ documents: [spell] });
  try {
    const result = await createItem(
      { name: "Fireball - Goblin Shaman", type: "Basic" },
      { pack: world.pack, onConflict: () => "replace" },
    );

    // The library document is untouched, whole.
    assert.equal(spell.updateCalls, undefined, "the stored spell was never updated");
    assert.equal(spell.deleted, undefined, "the stored spell was never deleted");
    assert.equal(spell.img, CURATED_ART);
    assert.equal(spell.system.description, CURATED_TEXT);
    assert.deepEqual(spell.system.properties, ["Compendium.x.Item.KEPT"]);
    assert.equal(spell.flags[MODULE_ID].monsterSpell.libraryId, "lib-fireball");

    // The GM's import still landed, under a free name.
    assert.equal(result.status, "created");
    assert.equal(result.name, "Fireball - Goblin Shaman (2)");
    assert.equal(world.created.length, 1);
    assert.equal(world.created[0].name, "Fireball - Goblin Shaman (2)");

    // ...and the GM was told, by name, what happened.
    assert.equal(result.collision.kind, "monster-spell");
    assert.equal(result.collision.protectedName, "Fireball - Goblin Shaman");
    assert.equal(result.collision.renamedTo, "Fireball - Goblin Shaman (2)");
    assert.equal(world.notifications.warn.length, 1);
    const notice = world.notifications.warn[0];
    assert.ok(notice.includes("Fireball - Goblin Shaman"), "the notice names the document");
    assert.ok(/monster spell/i.test(notice), "the notice says what it protected");
    assert.ok(notice.includes("Fireball - Goblin Shaman (2)"), "the notice states the outcome");
  } finally {
    world.restore();
  }
});

test("Skip and Keep-both are already safe and are left alone", async () => {
  for (const [choice, expected] of [["skip", "skipped"], ["rename", "created"]]) {
    const spell = storedSpell();
    const world = fakeWorld({ documents: [spell] });
    try {
      const result = await createItem(
        { name: "Fireball - Goblin Shaman", type: "Basic" },
        { pack: world.pack, onConflict: () => choice },
      );
      assert.equal(result.status, expected);
      assert.equal(result.collision, undefined, `${choice} raises no collision notice`);
      assert.equal(world.notifications.warn.length, 0);
      assert.equal(spell.updateCalls, undefined);
    } finally {
      world.restore();
    }
  }
});

test("an ordinary item with an ordinary name collision still replaces", async () => {
  const ordinary = storedSpell({
    _id: "doc-2",
    name: "Rope, 60'",
    type: "Basic",
    flags: { [MODULE_ID]: { imported: true } },
    system: { description: "<p>Sixty feet of hemp.</p>" },
  });
  const world = fakeWorld({ documents: [ordinary] });
  try {
    const result = await createItem(
      { name: "Rope, 60'", type: "Basic", description: "<p>Fresh paste.</p>" },
      { pack: world.pack, onConflict: () => "replace" },
    );
    assert.equal(result.status, "replaced");
    assert.equal(result.collision, undefined);
    assert.equal(world.notifications.warn.length, 0);
  } finally {
    world.restore();
  }
});

test("a batch commit reports every protected collision", async () => {
  const spell = storedSpell();
  const world = fakeWorld({ documents: [spell] });
  try {
    const result = await createItems(
      [{ name: "Fireball - Goblin Shaman", type: "Basic" }, { name: "Torch", type: "Basic" }],
      { source: "wr", onConflict: () => "replace" },
    );
    assert.equal(result.created.length, 2);
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].protectedName, "Fireball - Goblin Shaman");
  } finally {
    world.restore();
  }
});

// ─── 5. The planner still owns exactly one document ──────────────────────────

const sourceActor = () => ({
  name: "Goblin Shaman",
  uuid: "Compendium.shadowdark.monsters.Actor.gob",
  sourcePack: "shadowdark.monsters",
  sourceLabel: "Shadowdark Core",
  items: [{
    _id: "spell-1",
    name: "Fireball",
    type: "Spell",
    img: "icons/magic/fire/beam-jet-stream-embers.webp",
    system: { tier: 3, description: "<p>Boom.</p>", duration: { type: "instant", value: "-1" } },
    effects: [],
  }],
});

test("after the protected collision the next refresh keeps one document, not two", () => {
  const [entry] = collectMonsterSpells([sourceActor()]);
  const stored = { _id: "doc-1", ...materializeMonsterSpell(entry) };

  // The GM curated it, then an ordinary import collided and was turned away:
  // content edited by hand, provenance intact.
  const curated = {
    ...stored,
    img: CURATED_ART,
    system: { ...stored.system, description: CURATED_TEXT },
  };

  const plan = planMonsterSpellRefresh([entry], [curated]);
  assert.equal(plan.create.length, 0, "no duplicate is generated");
  assert.equal(plan.conflict.length, 1, "the hand-edit is reported as a preserved curated conflict");
  assert.equal(plan.conflict[0].document._id, "doc-1");
});

test("REGRESSION: erasing the provenance block is what produced the duplicate", () => {
  // Exactly the pre-A8 outcome of a `recursive: false` replacement: same name,
  // same content, no `monsterSpell` block. The planner cannot see it, so the
  // refresh creates a second copy beside it.
  const [entry] = collectMonsterSpells([sourceActor()]);
  const stored = { _id: "doc-1", ...materializeMonsterSpell(entry) };
  const wiped = { ...stored, flags: { [MODULE_ID]: { imported: true, source: "wr" } } };

  assert.equal(planMonsterSpellRefresh([entry], [wiped]).create.length, 1);
});

// ─── 6. The replace-time curation path, end to end ───────────────────────────

test("a permitted Spell replacement keeps curated text, art, properties and provenance", () => {
  // The A3 path with A8's description rule: even where replacement IS allowed
  // (an ordinary spell re-import in the Spells pack), the importer's
  // `<p>{name}</p>` fallback no longer displaces curated prose.
  const stored = {
    name: "Blast - Mage", type: "Spell", img: CURATED_ART,
    flags: monsterSpellFlags(),
    system: { description: CURATED_TEXT, properties: ["Compendium.x.Item.KEPT"] },
  };
  const payload = buildItemData({ name: "Blast - Mage", type: "Spell", tier: 3 });
  payload.system.properties = [];
  assert.equal(payload.system.description, "<p>Blast - Mage</p>", "precondition: the name-echo fallback");

  preserveCuratedFields(payload, stored, { generatedArtifact: false });

  assert.equal(payload.system.description, CURATED_TEXT);
  assert.equal(payload.img, CURATED_ART);
  assert.deepEqual(payload.system.properties, ["Compendium.x.Item.KEPT"]);
});
