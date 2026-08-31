/**
 * A7 remediation — the Foundry-bound half of generated-item reconciliation.
 *
 * Two things the pure planner fixtures cannot reach.
 *
 * THE BLOCKER: an authoritative rerun must not delete another package's flags.
 * `replaceDocument` updates with `recursive: false` and `preservedModuleFlags`
 * rescues undeclared keys only inside OUR namespace, so a foreign block survives
 * solely because the outgoing payload restated it. These tests drive the REAL
 * `replaceDocument` — both the in-place branch and the create-then-delete
 * fallback — because the fix is only true if it holds on the branch that
 * destroys the original and inherits nothing.
 *
 * FAILURE SHAPES: reconciliation is retryable, not transactional. Every step
 * that does not complete must be reported rather than silently skipped, since a
 * silent skip is indistinguishable from success in the returned counts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GENERATED_ITEM_FAILURES, stampGeneratedItem, planGeneratedItems, reconcileGeneratedItems,
} from "../scripts/shared/generated-items.mjs";
import { replaceDocument } from "../scripts/shared/compendium-suite.mjs";
import { MANAGED_ITEMS_PACK } from "../scripts/shared/art-provenance.mjs";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

const SDX = "shadowdark-extras";
const PACK = { collection: MANAGED_ITEMS_PACK };

const definition = (name) => ({
  name, type: "Basic",
  img: "icons/commodities/bones/bone-carved-brown.webp",
  system: { description: `<p>${name}</p>`, treasure: true },
});

/** A stored document with foreign flags a GM/another module put there. */
function storedDoc(payload, id = "doc-1") {
  return {
    _id: id,
    ...payload,
    system: { ...payload.system, quantity: 1, equipped: false },
    effects: [],
    flags: {
      ...payload.flags,
      [SDX]: { alignment: "chaotic", carousingSession: "s-7" },
      core: { sourceId: "Compendium.x.y.Item.z" },
      [MODULE_ID]: { ...payload.flags[MODULE_ID], manifestId: "unrelated-ours" },
    },
  };
}

/** Minimal Foundry Item stand-in for replaceDocument. */
function fakeDoc(data, { failUpdate = false, failDelete = false } = {}) {
  const doc = {
    documentName: "Item", id: data._id, name: data.name, type: data.type,
    flags: data.flags, written: null, created: null, deleted: false,
    toObject: () => ({ ...data }),
    getEmbeddedCollection: () => (data.effects ?? []).map((e, i) => ({ id: e._id ?? `e${i}` })),
    deleteEmbeddedDocuments: async () => {},
    createEmbeddedDocuments: async (_n, rows) => { doc.rows = rows; },
    update: async (d) => { if (failUpdate) throw new Error("in-place update refused"); doc.written = d; return doc; },
    delete: async () => { if (failDelete) throw new Error("delete failed"); doc.deleted = true; return doc; },
  };
  doc.constructor = { create: async (d) => { doc.created = d; return { ...d, id: "recreated" }; } };
  return doc;
}

/** Plan one definition against one stored document and return its payload. */
function updatePayloadFor(def, stored) {
  const plan = planGeneratedItems({
    desired: [def], existing: [stored], packCollection: MANAGED_ITEMS_PACK, source: "CS1",
  });
  assert.equal(plan.update.length, 1, "expected exactly one update entry");
  return plan.update[0].payload;
}

describe("A7 adapter — undeclared third-party flags survive an authoritative update", () => {
  const def = definition("Carved Bone");
  const stored = storedDoc(stampGeneratedItem(definition("Carved Bone"), { source: "CS1" }));
  // A hand edit so the rerun is a real update, not an unchanged no-op.
  stored.img = "worlds/mine/hand-picked.webp";

  test("the plan's payload restates foreign namespaces and keeps ours declared", () => {
    const payload = updatePayloadFor(def, stored);
    assert.equal(payload.flags[SDX].alignment, "chaotic");
    assert.equal(payload.flags[SDX].carousingSession, "s-7");
    assert.equal(payload.flags.core.sourceId, "Compendium.x.y.Item.z");
    assert.equal(payload.flags[MODULE_ID].generated, true);
    assert.ok(payload.flags[MODULE_ID].generatedItem.id);
  });

  test("foreign flags do NOT enter the identity or the content witness", () => {
    // Otherwise SDX writing an alignment would read as a changed definition.
    const clean = stampGeneratedItem(def, { source: "CS1" }).flags[MODULE_ID].generatedItem;
    const payload = updatePayloadFor(def, stored);
    assert.equal(payload.flags[MODULE_ID].generatedItem.id, clean.id);
    assert.equal(payload.flags[MODULE_ID].generatedItem.fingerprint, clean.fingerprint);
  });

  test("IN-PLACE branch: replaceDocument writes them back", async () => {
    const doc = fakeDoc(stored);
    const out = await replaceDocument(doc, updatePayloadFor(def, stored), PACK);
    assert.equal(out.mode, "updated");
    assert.equal(doc.written.flags[SDX].alignment, "chaotic");
    assert.equal(doc.written.flags.core.sourceId, "Compendium.x.y.Item.z");
    assert.equal(doc.written.flags[MODULE_ID].manifestId, "unrelated-ours", "A8 own-namespace rescue still holds");
    assert.equal(doc.written.img, "icons/commodities/bones/bone-carved-brown.webp", "declared content still authoritative");
  });

  test("CREATE-THEN-DELETE branch: the replacement carries them too", async () => {
    // The branch that inherits nothing — anything the payload omits is gone.
    const doc = fakeDoc(stored, { failUpdate: true });
    const out = await replaceDocument(doc, updatePayloadFor(def, stored), PACK);
    assert.equal(out.mode, "recreated");
    assert.equal(doc.created.flags[SDX].alignment, "chaotic");
    assert.equal(doc.created.flags[SDX].carousingSession, "s-7");
    assert.equal(doc.created.flags.core.sourceId, "Compendium.x.y.Item.z");
    assert.equal(doc.created.flags[MODULE_ID].generated, true);
    assert.equal(doc.deleted, true);
  });

  test("a namespace the definition DOES declare stays authoritative", async () => {
    const declaring = { ...definition("Carved Bone"), flags: { [SDX]: { alignment: "lawful" } } };
    const payload = updatePayloadFor(declaring, stored);
    assert.equal(payload.flags[SDX].alignment, "lawful", "declared wins over stored");
    assert.equal(payload.flags[SDX].carousingSession, undefined, "and replaces the block wholesale");
  });

  test("a stored document with no foreign flags produces an unchanged payload", () => {
    const bare = { ...stampGeneratedItem(definition("Eyeball"), { source: "CS1" }), _id: "d2", img: "x.webp" };
    const payload = updatePayloadFor(definition("Eyeball"), bare);
    assert.deepEqual(Object.keys(payload.flags), [MODULE_ID]);
  });
});

describe("A7 adapter — failure shapes are reported, never swallowed", () => {
  const defs = ["Carved Bone", "Eyeball", "Iron Nail"].map(definition);
  const pack = (docs = []) => ({
    collection: MANAGED_ITEMS_PACK,
    getDocuments: async () => docs,
  });
  const doc = (payload, id) => ({ id, toObject: () => ({ _id: id, ...payload }) });

  test("a create returning nothing is a create-failed row, and the batch continues", async () => {
    let n = 0;
    const out = await reconcileGeneratedItems(pack(), defs, {
      source: "CS1",
      adapter: { createItem: async () => (++n === 2 ? null : {}), notify: () => {} },
    });
    assert.equal(out.created, 2);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].reason, GENERATED_ITEM_FAILURES.CREATE_FAILED);
    assert.equal(out.failures[0].name, "Eyeball");
  });

  test("a partial run is retryable — the rerun creates only what is missing", async () => {
    const landed = defs.slice(0, 2).map((d) => stampGeneratedItem(d, { source: "CS1" }));
    const created = [];
    const out = await reconcileGeneratedItems(
      pack(landed.map((p, i) => doc(p, `doc-${i}`))), defs,
      { source: "CS1", adapter: { createItem: async (p) => { created.push(p.name); return {}; }, notify: () => {} } },
    );
    assert.deepEqual(created, ["Iron Nail"]);
    assert.equal(out.unchanged, 2);
    assert.equal(out.failures.length, 0);
  });

  test("a throwing update is reported and does not strand the rest of the batch", async () => {
    const landed = defs.map((d) => stampGeneratedItem(d, { source: "CS1" }));
    landed.forEach((p) => { p.img = "worlds/mine/edited.webp"; });   // force three updates
    let calls = 0;
    const out = await reconcileGeneratedItems(
      pack(landed.map((p, i) => doc(p, `doc-${i}`))), defs,
      { source: "CS1", adapter: {
        replace: async () => { if (++calls === 1) throw new Error("pack locked"); return {}; },
        notify: () => {},
      } },
    );
    assert.equal(out.updated, 2, "the other two still got written");
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].reason, GENERATED_ITEM_FAILURES.UPDATE_FAILED);
    assert.equal(out.failures[0].error, "pack locked");
  });

  test("a target that vanished between plan and apply is missing-target, not silence", async () => {
    const landed = stampGeneratedItem(defs[0], { source: "CS1" });
    landed.img = "worlds/mine/edited.webp";
    const vanishing = { id: "ghost", toObject: () => ({ _id: "not-the-same-id", ...landed }) };
    const out = await reconcileGeneratedItems(pack([vanishing]), [defs[0]], {
      source: "CS1", adapter: { replace: async () => ({}), notify: () => {} },
    });
    assert.equal(out.updated, 0);
    assert.equal(out.failures[0].reason, GENERATED_ITEM_FAILURES.MISSING_TARGET);
  });

  test("a failed delete in the recreate branch leaves a duplicate the NEXT plan reports", async () => {
    // replaceDocument creates the replacement before deleting the original, so
    // a delete failure is the one case reconciliation cannot heal. The
    // reconciliation adapter reports the failed update, and the next pure plan
    // reports the duplicate for manual GM cleanup.
    const stored = storedDoc(stampGeneratedItem(definition("Carved Bone"), { source: "CS1" }));
    stored.img = "worlds/mine/edited.webp";
    const d = fakeDoc(stored, { failUpdate: true, failDelete: true });
    const out = await reconcileGeneratedItems(
      { collection: MANAGED_ITEMS_PACK, getDocuments: async () => [d] },
      [definition("Carved Bone")],
      {
        source: "CS1",
        adapter: {
          replace: (doc, payload) => replaceDocument(doc, payload, PACK),
          notify: () => {},
        },
      },
    );
    assert.equal(out.updated, 0);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].reason, GENERATED_ITEM_FAILURES.UPDATE_FAILED);
    assert.equal(out.failures[0].error, "delete failed");
    assert.ok(d.created, "the replacement was already created");
    assert.equal(d.deleted, false, "the original is still there");

    const survivors = [stored, { ...stored, _id: "doc-2" }];
    const next = planGeneratedItems({
      desired: [definition("Carved Bone")], existing: survivors,
      packCollection: MANAGED_ITEMS_PACK, source: "CS1",
    });
    assert.equal(next.refused[0].reason, "duplicate-document");
    assert.equal(next.refused[0].documentId, "doc-2");
    assert.equal(next.update.length, 1, "reported, and explicitly NOT healed");
  });

  test("refusals and failures are surfaced to the GM in one notice", async () => {
    const notices = [];
    await reconcileGeneratedItems(pack(), defs, {
      source: "CS1",
      adapter: { createItem: async () => null, notify: (m) => notices.push(m) },
    });
    assert.equal(notices.length, 1);
    assert.match(notices[0], /3 generated item\(s\) were not written/);
    assert.match(notices[0], /create-failed/);
  });

  test("a pack outside the boundary writes nothing at all", async () => {
    let writes = 0;
    const out = await reconcileGeneratedItems({ collection: "shadowdark.gear", getDocuments: async () => [] }, defs, {
      source: "CS1",
      adapter: { createItem: async () => { writes += 1; return {}; }, notify: () => {} },
    });
    assert.equal(writes, 0);
    assert.equal(out.created, 0);
    assert.equal(out.plan.boundary, false);
  });
});
