/**
 * Quench batch: gear-table currency rows never become items.
 *
 * The Basic Gear table lists Coin and Gem next to real equipment. Both price
 * "Varies", so the importer used to mint them as 0 gp items that then sat in
 * `Manage > Items > Basic Gear` forever. The pure rule (isCurrencyName) is
 * covered by test/gear-currency-rows.test.mjs; what only a live world can
 * prove is the two Foundry-bound halves:
 *
 *   - the Manage tree, built from the REAL sde-items census, leaves a Coin /
 *     Gem document out of the Basic Gear leaf while still listing gear beside
 *     it (the symptom the GM actually reported);
 *   - a pasted gear table commits through the real createItems path without
 *     either row reaching the pack.
 *
 * Deletion safety: the bare "Coin" / "Gem" fixtures cannot be name-matched for
 * cleanup without risking the GM's own documents, so each is stamped
 * `flags.<module>.quenchFixture` at creation and cleanup matches on THAT — a
 * flag nothing else in the module ever writes. `after()` deletes only ids this
 * run created; `before()` self-heals a crashed prior run by the same flag (plus
 * the fixture prefix). A Coin or Gem the GM already had is never touched.
 * Registered only via quenchReady (see shadowdark-enhancer.mjs); test/ never
 * ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";
import { itemRecognizer, isCurrencyName } from "../../scripts/importer/items/item-parser.mjs";
import { createItems } from "../../scripts/importer/items/item-importer.mjs";
import { buildManageTree } from "../../scripts/importer/manage-tree.mjs";
import { findSuitePack } from "../../scripts/shared/compendium-suite.mjs";

// Plain words only: a parsed row's name is title-cased (titleCaseName), so an
// acronym in the prefix would come back as "Sde" and stop matching itself.
const FIXTURE_PREFIX = "Quench Gear Currency";
const SOURCE_LABEL = "Quench SDE Source";

/** The Basic Gear leaf of a freshly built Manage tree. */
async function basicGearLeaf() {
  const tree = await buildManageTree();
  const items = tree.find((n) => n.id === "items");
  return items?.children?.find((c) => c.id === "items/basic") ?? null;
}

export function registerGearCurrencyBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.gear-currency", (context) => {
    const { describe, it, assert, before, after } = context;

    const FIXTURE_FLAG = `flags.${MODULE_ID}.quenchFixture`;

    let itemsPack = null;
    const preExistingIds = new Set();   // never touched by this batch
    const createdIds = new Set();       // the only ids after() may delete

    /** Ids of leftover fixtures: our own flag, or the unique name prefix.
     *  Never a bare "Coin"/"Gem" the GM's own import created. */
    async function fixtureIds() {
      const index = await itemsPack.getIndex({ fields: [FIXTURE_FLAG] });
      return [...index]
        .filter((e) => e.flags?.[MODULE_ID]?.quenchFixture === true
          || (e.name ?? "").includes(FIXTURE_PREFIX))
        .map((e) => e._id);
    }

    async function deleteIds(ids) {
      if (ids.length) await itemsPack.documentClass.deleteDocuments(ids, { pack: itemsPack.collection });
    }

    /** Create a document straight in the pack, bypassing the commit path's
     *  conflict flow — a world that already has a "Coin" must not make this
     *  fixture land as "Coin (2)" and quietly stop testing the rule. */
    const seed = async (name) => {
      const doc = await itemsPack.documentClass.create(
        {
          name, type: "Basic",
          system: { cost: { gp: 0, sp: 0, cp: 0 } },
          flags: { [MODULE_ID]: { quenchFixture: true } },
        },
        { pack: itemsPack.collection },
      );
      createdIds.add(doc.id);
      return doc;
    };

    before(async function () {
      this.timeout(60000);
      if (!game.user.isGM) this.skip();
      itemsPack = findSuitePack("sde-items");
      // The suite pack is created lazily by real imports; a world that has
      // never imported has no census to reconcile against. Skip, don't create.
      if (!itemsPack) this.skip();
      if (itemsPack.locked) { try { await itemsPack.configure({ locked: false }); } catch (_) {} }
      await deleteIds(await fixtureIds());        // self-heal a crashed prior run
      for (const e of await itemsPack.getIndex()) preExistingIds.add(e._id);
    });

    after(async function () {
      this.timeout(60000);
      await deleteIds([...createdIds].filter((id) => !preExistingIds.has(id)));
      const folder = itemsPack?.folders?.find((f) => f.name === SOURCE_LABEL);
      if (folder && !folder.contents.length && !folder.children.length) await folder.delete();
    });

    describe("Manage tree — Items > Basic Gear", function () {
      before(async function () {
        this.timeout(60000);
        await seed("Coin");
        await seed("Gem");
        await seed(`${FIXTURE_PREFIX} Lantern Hook`);
      });

      it("lists the gear document beside them", async function () {
        this.timeout(120000);
        const leaf = await basicGearLeaf();
        assert.exists(leaf, "no items/basic leaf in the Manage tree");
        assert.equal(leaf.label, "Basic Gear");
        const names = leaf.entries.map((e) => e.name);
        assert.include(names, `${FIXTURE_PREFIX} Lantern Hook`,
          "the leaf stopped listing ordinary imported gear");
      });

      it("leaves a Coin and a Gem document out of the leaf", async function () {
        this.timeout(120000);
        const leaf = await basicGearLeaf();
        const bare = leaf.entries
          .map((e) => e.name)
          .filter((n) => isCurrencyName(n));
        assert.deepEqual(bare, [], `currency rows are back in Basic Gear: ${bare.join(", ")}`);
      });
    });

    describe("pasted gear table → commit", function () {
      // Invented rows, per the no-book-content rule: the two currency names are
      // the only real thing here, and they are what must NOT survive.
      const dump = [
        "Item Cost Quantity per Gear Slot",
        `${FIXTURE_PREFIX} Ball Bearing 1 gp 1`,
        "Coin Varies 100",
        "Gem Varies 1",
        `${FIXTURE_PREFIX} Tallow Jar 4 sp 1`,
      ].join("\n");

      it("reports both currency rows as skipped, with the reason", function () {
        const { skipped } = itemRecognizer.claim(dump, { force: true });
        const names = skipped.map((s) => s.name);
        assert.include(names, "Coin");
        assert.include(names, "Gem");
        for (const s of skipped) assert.match(s.reason, /currency, not gear/);
      });

      it("commits the gear and nothing else into sde-items", async function () {
        this.timeout(120000);
        const { claimed } = itemRecognizer.claim(dump, { force: true });
        const drafts = itemRecognizer.parse(claimed, { force: true }).map(({ draft }) => draft);
        const out = await createItems(drafts, { source: SOURCE_LABEL });
        assert.exists(out, "createItems returned nothing — GM only?");
        for (const c of [...out.created, ...out.replaced]) {
          const doc = await fromUuid(c.uuid);
          if (doc && !preExistingIds.has(doc.id)) createdIds.add(doc.id);
        }
        const committed = [...out.created, ...out.replaced].map((c) => c.name);
        assert.equal(out.created.length, 2, `expected the two gear rows, got: ${committed.join(", ")}`);
        for (const n of committed) {
          assert.ok(!isCurrencyName(n), `currency reached the pack as "${n}"`);
        }
        const doc = await fromUuid(out.created[0].uuid);
        assert.isTrue(doc.flags?.[MODULE_ID]?.imported === true, "imported flag missing");
      });
    });
  }, { displayName: "Shadowdark Enhancer: gear-table currency rows (Coin, Gem)" });
}
