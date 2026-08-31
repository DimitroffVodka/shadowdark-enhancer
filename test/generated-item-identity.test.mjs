/**
 * A7/#57–#59 — stable identity and replace-always reconciliation for generated
 * managed Items.
 *
 * Two things are pinned here. The IDENTITY: derived from the definition, stable
 * across a rerun that changes art/price/prose, and never read from an image
 * path or a fuzzy name. The BOUNDARY: replace-always holds only inside the
 * managed Items pack, only for `flags[MODULE_ID].generated === true`, and never
 * for a generated Monster Spell — whose own marker means the OPPOSITE thing
 * (A8, module-flags.mjs) and shares this pack since A1.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GENERATED_ITEM_REFUSALS,
  generatedItemKey, generatedItemId, generatedItemFingerprint,
  readGeneratedItem, isGeneratedItem, stampGeneratedItem, planGeneratedItems,
} from "../scripts/shared/generated-items.mjs";
import { MANAGED_ITEMS_PACK, isGeneratedArtifact, decideImportArt } from "../scripts/shared/art-provenance.mjs";
import { isGeneratedMonsterSpell } from "../scripts/shared/module-flags.mjs";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

/** A D6-shaped definition: the twenty Diabolical Treasure rows look like this. */
const definition = (name, over = {}) => ({
  name,
  type: "Basic",
  img: "icons/commodities/bones/bone-carved-brown.webp",
  system: {
    description: `<p>${name}</p>`,
    cost: { gp: 0, sp: 0, cp: 0 },
    treasure: true,
    magicItem: true,
    ...(over.system ?? {}),
  },
  ...over,
});

/** What Foundry hands back: the payload plus every DataModel default. */
const stored = (payload, id = "doc-1") => ({
  _id: id,
  ...payload,
  system: {
    ...payload.system,
    quantity: 1,
    slots: { free_carry: 0, per_slot: 1, slots_used: 1 },
    equipped: false,
  },
  effects: [],
  folder: "folder-abc",
  sort: 100000,
  ownership: { default: 0 },
});

const plan = (desired, existing, pack = MANAGED_ITEMS_PACK) =>
  planGeneratedItems({ desired, existing, packCollection: pack, source: "CS1" });

describe("generated identity — derivation", () => {
  test("the key is source-qualified and canonical across spellings", () => {
    const want = "cs1:carved bone";
    for (const spelling of ["CS1", "cs1", "Cursed Scroll 1", "Cursed Scroll #1", "Diablerie"]) {
      assert.equal(generatedItemKey(spelling, "Carved Bone"), want, spelling);
    }
  });

  test("the same definition mints the same id every time", () => {
    assert.equal(generatedItemId("CS1", "Carved Bone"), generatedItemId("cs1", " carved  bone "));
    assert.match(generatedItemId("CS1", "Carved Bone"), /^fnv1a32:[0-9a-f]{8}$/);
  });

  test("two books printing one name are two identities", () => {
    assert.notEqual(generatedItemId("CS1", "Carved Bone"), generatedItemId("CS3", "Carved Bone"));
  });

  test("identity survives a definition whose art, price and prose all change", () => {
    const before = stampGeneratedItem(definition("Carved Bone"), { source: "CS1" });
    const after = stampGeneratedItem(
      definition("Carved Bone", {
        img: "icons/svg/mystery-man.svg",
        system: { description: "<p>Ignites in flames once per day.</p>", cost: { gp: 50, sp: 0, cp: 0 } },
      }),
      { source: "CS1" },
    );
    const a = before.flags[MODULE_ID].generatedItem;
    const b = after.flags[MODULE_ID].generatedItem;
    assert.equal(a.id, b.id, "identity must not move with content");
    assert.notEqual(a.fingerprint, b.fingerprint, "the witness must move with content");
  });

  test("an unkeyable definition mints nothing rather than a guess", () => {
    assert.equal(generatedItemKey("", "Carved Bone"), "");
    assert.equal(generatedItemKey("CS1", "   "), "");
    assert.equal(stampGeneratedItem(definition("Carved Bone"), { source: "" }), null);
  });

  test("identity is not the image path, the folder, or the document id", () => {
    const base = definition("Carved Bone");
    const one = stampGeneratedItem({ ...base, img: "a.webp", folder: "f1" }, { source: "CS1" });
    const two = stampGeneratedItem({ ...base, img: "b.webp", folder: "f2" }, { source: "CS1" });
    assert.equal(one.flags[MODULE_ID].generatedItem.id, two.flags[MODULE_ID].generatedItem.id);
  });

  test("folder is placement, not content — moving one is not an edit", () => {
    const base = definition("Carved Bone");
    assert.equal(generatedItemFingerprint({ ...base, folder: "f1" }),
      generatedItemFingerprint({ ...base, folder: "f2" }));
  });

  test("the definition-level source hint never lands on the document", () => {
    const payload = stampGeneratedItem({ ...definition("Carved Bone"), source: "CS1" });
    assert.equal("source" in payload, false);
    assert.equal(payload.flags[MODULE_ID].generatedItem.source, "cs1");
  });

  test("stamping is additive — other packages' flags survive", () => {
    const payload = stampGeneratedItem(
      { ...definition("Carved Bone"), flags: { "shadowdark-extras": { alignment: "chaotic" } } },
      { source: "CS1" },
    );
    assert.equal(payload.flags["shadowdark-extras"].alignment, "chaotic");
    assert.equal(payload.flags[MODULE_ID].generated, true);
  });
});

describe("generated identity — the boundary", () => {
  const payload = stampGeneratedItem(definition("Carved Bone"), { source: "CS1" });

  test("a stamped payload satisfies BOTH halves only in the managed pack", () => {
    assert.equal(isGeneratedArtifact(payload), true);
    assert.equal(isGeneratedItem(payload, MANAGED_ITEMS_PACK), true);
    for (const pack of ["shadowdark.gear", "world.loot", "world.shadowdark-enhancer--actors", ""]) {
      assert.equal(isGeneratedItem(payload, pack), false, pack);
    }
  });

  test("a plan outside the managed pack writes nothing at all", () => {
    const out = plan([definition("Carved Bone")], [], "shadowdark.gear");
    assert.equal(out.boundary, false);
    assert.deepEqual([out.create, out.update, out.unchanged], [[], [], []]);
    assert.equal(out.refused[0].reason, GENERATED_ITEM_REFUSALS.OUT_OF_BOUNDARY);
  });

  test("the marker alone, without the block, is not an identity", () => {
    const marked = { name: "Carved Bone", flags: { [MODULE_ID]: { generated: true } } };
    assert.equal(isGeneratedArtifact(marked), true);
    assert.equal(readGeneratedItem(marked), null);
    assert.equal(isGeneratedItem(marked, MANAGED_ITEMS_PACK), false);
  });

  test("the block alone, without the marker, is not a generated artifact", () => {
    const unmarked = {
      name: "Carved Bone",
      flags: { [MODULE_ID]: { generatedItem: { id: "fnv1a32:deadbeef" } } },
    };
    assert.equal(readGeneratedItem(unmarked), null);
  });

  test("monsterSpell.generated is NOT this marker — the contracts are opposites", () => {
    const spell = {
      _id: "spell-1",
      name: "Carved Bone",
      flags: { [MODULE_ID]: { monsterSpell: { generated: true, libraryId: "fnv1a32:8a2810bf" } } },
    };
    assert.equal(isGeneratedMonsterSpell(spell), true);
    assert.equal(isGeneratedArtifact(spell), false);
    assert.equal(isGeneratedItem(spell, MANAGED_ITEMS_PACK), false);

    // And a definition that would take its name is refused, not honoured.
    const out = plan([definition("Carved Bone")], [spell]);
    assert.deepEqual([out.create, out.update], [[], []]);
    assert.equal(out.refused[0].reason, GENERATED_ITEM_REFUSALS.NAME_COLLISION);
    assert.equal(out.refused[0].monsterSpell, true);
    assert.equal(out.refused[0].documentId, "spell-1");
  });

  test("art provenance treats the boundary as authoritative, GM edits included", () => {
    const gmEdited = { img: "worlds/mine/hand-picked.webp" };
    assert.equal(decideImportArt({
      incomingImg: "icons/commodities/bones/bone-carved-brown.webp",
      existing: gmEdited, generatedArtifact: true,
    }).preserved, false);
    assert.equal(decideImportArt({
      incomingImg: "icons/commodities/bones/bone-carved-brown.webp",
      existing: gmEdited, generatedArtifact: false,
    }).preserved, true);
  });
});

describe("generated reconciliation — create, update, rerun", () => {
  const defs = [definition("Carved Bone"), definition("Eyeball"), definition("Iron Nail")];

  test("a first run creates every definition once", () => {
    const out = plan(defs, []);
    assert.equal(out.create.length, 3);
    assert.deepEqual([out.update.length, out.unchanged.length, out.refused.length], [0, 0, 0]);
    assert.equal(new Set(out.create.map((c) => c.id)).size, 3);
    for (const entry of out.create) assert.equal(entry.payload.flags[MODULE_ID].generated, true);
  });

  test("a rerun with nothing changed writes nothing and duplicates nothing", () => {
    const existing = plan(defs, []).create.map((c, i) => stored(c.payload, `doc-${i}`));
    const out = plan(defs, existing);
    assert.deepEqual([out.create.length, out.update.length, out.refused.length], [0, 0, 0]);
    assert.equal(out.unchanged.length, 3);
  });

  test("a hand edit is replaced, art included, and matched by identity not name", () => {
    const first = plan(defs, []).create;
    const edited = stored({
      ...first[0].payload,
      name: "Carved Bone of Utter Doom",             // renamed by hand
      img: "worlds/mine/hand-picked.webp",           // re-arted by hand
      system: { ...first[0].payload.system, description: "<p>My own notes.</p>" },
    }, "doc-0");
    const untouched = first.slice(1).map((c, i) => stored(c.payload, `doc-${i + 1}`));

    const out = plan(defs, [edited, ...untouched]);
    assert.equal(out.create.length, 0, "a renamed document must not be duplicated");
    assert.equal(out.update.length, 1);
    assert.equal(out.unchanged.length, 2);

    const [hit] = out.update;
    assert.equal(hit.documentId, "doc-0");
    assert.equal(hit.documentMoved, true);
    assert.equal(hit.definitionMoved, false);
    assert.equal(hit.payload.name, "Carved Bone");
    assert.equal(hit.payload.img, "icons/commodities/bones/bone-carved-brown.webp");
    assert.equal(hit.payload.system.description, "<p>Carved Bone</p>");
  });

  test("a changed definition updates the same document", () => {
    const existing = plan(defs, []).create.map((c, i) => stored(c.payload, `doc-${i}`));
    const revised = [
      definition("Carved Bone", { system: { description: "<p>Ignites in flames.</p>" } }),
      ...defs.slice(1),
    ];
    const out = plan(revised, existing);
    assert.equal(out.update.length, 1);
    assert.equal(out.update[0].definitionMoved, true);
    assert.equal(out.update[0].documentMoved, true);
    assert.equal(out.update[0].documentId, "doc-0");
    assert.equal(out.create.length, 0);
  });

  test("Foundry's own DataModel defaults are not read as a hand edit", () => {
    // `stored` adds quantity/slots/equipped/sort/ownership the definition never
    // declared. Comparing whole documents would call every rerun an edit.
    const [created] = plan([definition("Carved Bone")], []).create;
    const out = plan([definition("Carved Bone")], [stored(created.payload)]);
    assert.equal(out.unchanged.length, 1);
    assert.equal(out.update.length, 0);
  });

  test("a partial rerun completes the set without touching what is already right", () => {
    const first = plan(defs, []).create;
    const half = [stored(first[0].payload, "doc-0")];     // only one landed
    const out = plan(defs, half);
    assert.equal(out.unchanged.length, 1);
    assert.equal(out.create.length, 2);
    assert.deepEqual(out.create.map((c) => c.name), ["Eyeball", "Iron Nail"]);
    assert.equal(out.update.length, 0);
  });

  test("repeated runs converge — the third run is a no-op", () => {
    let existing = [];
    const counts = [];
    for (let run = 0; run < 3; run += 1) {
      const out = plan(defs, existing);
      counts.push([out.create.length, out.update.length, out.unchanged.length]);
      existing = [
        ...existing,
        ...out.create.map((c, i) => stored(c.payload, `doc-${existing.length + i}`)),
      ];
    }
    assert.deepEqual(counts, [[3, 0, 0], [0, 0, 3], [0, 0, 3]]);
    assert.equal(existing.length, 3, "no duplicates across three runs");
  });
});

describe("generated reconciliation — refusals", () => {
  test("a name already held by an unrelated document is refused, not taken over", () => {
    const handMade = { _id: "hand-1", name: "Carved Bone", flags: {} };
    const out = plan([definition("Carved Bone")], [handMade]);
    assert.equal(out.create.length, 0);
    assert.equal(out.refused[0].reason, GENERATED_ITEM_REFUSALS.NAME_COLLISION);
    assert.equal(out.refused[0].monsterSpell, false);
  });

  test("the collision check folds names the way the resolver does", () => {
    const handMade = { _id: "hand-1", name: "  carved   BONE ", flags: {} };
    assert.equal(plan([definition("Carved Bone")], [handMade]).refused.length, 1);
  });

  test("one definition listed twice creates one document", () => {
    const out = plan([definition("Carved Bone"), definition("carved bone")], []);
    assert.equal(out.create.length, 1);
    assert.equal(out.refused[0].reason, GENERATED_ITEM_REFUSALS.DUPLICATE_DEFINITION);
  });

  test("a definition that cannot be keyed is refused, never guessed at", () => {
    const out = planGeneratedItems({
      desired: [definition("   ")],
      existing: [],
      packCollection: MANAGED_ITEMS_PACK,
      source: "CS1",
    });
    assert.equal(out.refused[0].reason, GENERATED_ITEM_REFUSALS.NO_IDENTITY);
  });

  test("two documents already sharing one identity are reported, not silently picked", () => {
    const [created] = plan([definition("Carved Bone")], []).create;
    const out = plan([definition("Carved Bone")], [
      stored(created.payload, "doc-0"),
      stored(created.payload, "doc-1"),
    ]);
    assert.equal(out.refused[0].reason, GENERATED_ITEM_REFUSALS.DUPLICATE_DOCUMENT);
    assert.equal(out.refused[0].documentId, "doc-1");
    assert.equal(out.unchanged.length, 1, "the first still reconciles");
  });

  test("an ordinary imported Item in the pack keeps A3 provenance, untouched", () => {
    const imported = {
      _id: "imp-1",
      name: "Longsword",
      img: "worlds/mine/gm-art.webp",
      flags: { [MODULE_ID]: { imported: true, source: "cs1", art: { state: "custom", img: "worlds/mine/gm-art.webp" } } },
    };
    const out = plan([definition("Carved Bone")], [imported]);
    assert.equal(out.create.length, 1, "an unrelated import is not in the way");
    assert.equal(isGeneratedItem(imported, MANAGED_ITEMS_PACK), false);
    assert.equal(decideImportArt({
      incomingImg: "icons/weapons/swords/greatsword-blue.webp",
      existing: imported,
      generatedArtifact: isGeneratedItem(imported, MANAGED_ITEMS_PACK),
    }).preserved, true);
  });
});
