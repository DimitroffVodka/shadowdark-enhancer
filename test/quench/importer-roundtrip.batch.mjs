/**
 * Quench batch: importer commit round-trip — never-overwrite invariants.
 *
 * Exercises the REAL commit choke points (createItems / createTable) against
 * the live sde-* packs, asserting the provenance contract the whole suite is
 * built on:
 *   - a committed draft lands exactly once, flagged imported + source-stamped;
 *   - re-importing the same draft NEVER silently touches the existing doc
 *     ("skip" leaves it byte-identical, the default renames the newcomer);
 *   - an explicit "replace" is IN-PLACE — the UUID survives so inbound links
 *     (@UUID references from tables, class talents) keep resolving.
 *
 * Self-sufficient: fixtures use a unique name prefix, before() self-heals
 * leftovers from a crashed prior run, after() deletes only prefix-matched
 * pack docs. Registered only via quenchReady (see shadowdark-enhancer.mjs);
 * test/ never ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";
import { createItems } from "../../scripts/importer/items/item-importer.mjs";
import { parseTables, createTable } from "../../scripts/importer/tables/table-importer.mjs";
import { findSuitePack } from "../../scripts/shared/compendium-suite.mjs";

const FIXTURE_PREFIX = "Quench SDE RT";
const SOURCE_LABEL = "Quench SDE Source";

const gearDraft = (description) => ({
  name: `${FIXTURE_PREFIX} Lantern`,
  type: "Basic",
  cost: { gp: 5, sp: 0, cp: 0 },
  description,
});

async function deleteFixtureDocs(pack) {
  if (!pack) return;
  const index = await pack.getIndex();
  const ids = [...index].filter((e) => (e.name ?? "").includes(FIXTURE_PREFIX)).map((e) => e._id);
  if (ids.length) await pack.documentClass.deleteDocuments(ids, { pack: pack.collection });
}

export function registerImporterRoundtripBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.importer-roundtrip", (context) => {
    const { describe, it, assert, before, after } = context;

    let itemsPack = null;
    let tablesPack = null;

    before(async function () {
      this.timeout(60000);
      if (!game.user.isGM) this.skip();
      itemsPack = findSuitePack("sde-items");
      tablesPack = findSuitePack("sde-tables");
      // The suite packs are created lazily by real imports; a world that has
      // never imported has nothing to round-trip against. Skip, don't create —
      // the batch must not leave new packs behind in a pristine world.
      if (!itemsPack || !tablesPack) this.skip();
      await deleteFixtureDocs(itemsPack);   // self-heal a crashed prior run
      await deleteFixtureDocs(tablesPack);
    });

    after(async function () {
      this.timeout(60000);
      await deleteFixtureDocs(itemsPack);
      await deleteFixtureDocs(tablesPack);
      // Drop the now-empty fixture source folder (created by ensureSourceFolder).
      const folder = itemsPack?.folders?.find((f) => f.name === SOURCE_LABEL);
      if (folder && !folder.contents.length && !folder.children.length) await folder.delete();
    });

    describe("item commit round-trip (sde-items)", function () {
      let firstUuid = null;

      it("commit creates exactly one flagged, source-stamped doc", async function () {
        this.timeout(60000);
        const out = await createItems([gearDraft("<p>first import</p>")], { source: SOURCE_LABEL });
        assert.equal(out.created.length, 1, "expected exactly one created");
        assert.equal(out.replaced.length, 0);
        assert.equal(out.skipped.length, 0);
        firstUuid = out.created[0].uuid;
        const doc = await fromUuid(firstUuid);
        assert.exists(doc, "created uuid does not resolve");
        assert.equal(doc.type, "Basic");
        assert.isTrue(doc.flags?.[MODULE_ID]?.imported === true, "imported flag missing");
        assert.equal(doc.flags?.[MODULE_ID]?.source, SOURCE_LABEL, "source stamp missing");
        assert.include(doc.system.description, "first import");
        assert.equal(doc.system.cost?.gp, 5, "cost not mapped");
      });

      it("re-import with skip leaves the original untouched", async function () {
        this.timeout(60000);
        const before_ = (await fromUuid(firstUuid)).toObject();
        const out = await createItems([gearDraft("<p>SECOND import — must not land</p>")], {
          source: SOURCE_LABEL, onConflict: async () => "skip",
        });
        assert.equal(out.skipped.length, 1, "expected a skip");
        assert.equal(out.created.length, 0);
        assert.equal(out.replaced.length, 0);
        const after_ = (await fromUuid(firstUuid)).toObject();
        assert.equal(after_.system.description, before_.system.description, "skip modified the doc");
        const index = await itemsPack.getIndex();
        const copies = [...index].filter((e) => e.name === gearDraft("").name);
        assert.equal(copies.length, 1, "skip changed the doc count");
      });

      it("re-import with replace updates IN PLACE — uuid survives", async function () {
        this.timeout(60000);
        const out = await createItems([gearDraft("<p>replacement text</p>")], {
          source: SOURCE_LABEL, onConflict: async () => "replace",
        });
        assert.equal(out.replaced.length, 1, "expected a replace");
        assert.equal(out.replaced[0].uuid, firstUuid,
          "replace minted a NEW uuid — inbound @UUID links are now broken");
        const doc = await fromUuid(firstUuid);
        assert.include(doc.system.description, "replacement text", "replace did not update content");
      });

      it("re-import with no conflict handler renames the newcomer (default never-overwrite)", async function () {
        this.timeout(60000);
        const out = await createItems([gearDraft("<p>third import</p>")], { source: SOURCE_LABEL });
        assert.equal(out.created.length, 1, "expected a renamed create");
        assert.notEqual(out.created[0].name, gearDraft("").name, "newcomer kept the colliding name");
        const original = await fromUuid(firstUuid);
        assert.include(original.system.description, "replacement text", "default path modified the original");
      });
    });

    describe("table commit round-trip (sde-tables)", function () {
      let tableUuid = null;
      const tableText = [
        `${FIXTURE_PREFIX} Omens`,
        "d4 Omen",
        "1 Alpha",
        "2 Beta",
        "3 Gamma",
        "4 Delta",
      ].join("\n");

      it("parse + commit creates the table with all rows", async function () {
        this.timeout(60000);
        const parsed = parseTables(tableText);
        assert.isAtLeast(parsed.length, 1, "parser did not recognize the fixture table");
        const table = await createTable(parsed[0], { onConflict: async () => "cancel" });
        assert.exists(table, "createTable returned nothing");
        assert.notOk(table.blocked, `createTable blocked: ${JSON.stringify(table.blockers ?? [])}`);
        tableUuid = table.uuid;
        assert.equal(table.results.size, 4, "row count mismatch");
        assert.equal(table.formula, "1d4", "die formula mismatch");
      });

      it("re-commit with cancel creates nothing and touches nothing", async function () {
        this.timeout(60000);
        const indexBefore = await tablesPack.getIndex();
        const countBefore = [...indexBefore].filter((e) => (e.name ?? "").includes(FIXTURE_PREFIX)).length;
        const parsed = parseTables(tableText);
        const out = await createTable(parsed[0], { onConflict: async () => "cancel" });
        assert.isNull(out, "cancel should return null");
        const indexAfter = await tablesPack.getIndex();
        const countAfter = [...indexAfter].filter((e) => (e.name ?? "").includes(FIXTURE_PREFIX)).length;
        assert.equal(countAfter, countBefore, "cancel changed the pack");
        const original = await fromUuid(tableUuid);
        assert.exists(original, "original table vanished");
      });
    });
  }, { displayName: "Shadowdark Enhancer: importer commit round-trip — never-overwrite" });
}
