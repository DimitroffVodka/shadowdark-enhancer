/**
 * Quench batch: Monster Creator "Update in place" — the save path that mutates
 * an EXISTING actor instead of creating one.
 *
 * This path can't be unit tested: it needs live documents, embedded-item
 * collections and a real `actor.update()`. It is also the only place in the
 * suite where Creator Save writes to an actor the GM already had, so the
 * invariants below are the ones that keep a "load it in and add a feature"
 * round trip from quietly corrupting a monster:
 *
 *   - it UPDATES, never duplicates (same actor id, no new world actor);
 *   - items reconcile by (type, name), so an untouched attack KEEPS ITS ITEM ID
 *     — the token quick-adjust's backup flag references attacks by id, and a
 *     wipe-and-recreate would silently break Revert;
 *   - renamed / removed draft entries delete their old items rather than
 *     accumulating orphans;
 *   - item types the Creator does not author (Effects, Talents, gear) are left
 *     completely alone;
 *   - a stale quick-adjust backup is CLEARED, because after the Creator has
 *     rewritten the stats that Revert point no longer describes reality;
 *   - the `system.notes` stat block is rebuilt to agree with the new data;
 *   - a source actor deleted mid-edit degrades to "create new", not a throw.
 *
 * Self-sufficient: fixtures use a unique name prefix, before() self-heals
 * leftovers from a crashed prior run, after() deletes only prefix-matched
 * actors. The Monster Creator is a session-long singleton holding the GM's
 * draft, so before()/after() snapshot and restore its state — a Quench run
 * must never eat someone's in-progress monster.
 *
 * Registered only via quenchReady (see shadowdark-enhancer.mjs); test/ never
 * ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";
import { MonsterCreator, actorToDraft } from "../../scripts/monster-creator/encounter-creator.mjs";

const FIXTURE_PREFIX = "Quench SDE Creator";

/** A minimal but complete NPC: one attack, one feature, real ability mods. */
function fixtureActorData(name) {
  return {
    name,
    type: "NPC",
    system: {
      alignment: "chaotic",
      level: { value: 6, xp: 0 },
      attributes: { ac: { value: 9 }, hp: { value: 30, max: 30 } },
      abilities: {
        str: { mod: 4 }, dex: { mod: -1 }, con: { mod: 3 },
        int: { mod: -2 }, wis: { mod: -2 }, cha: { mod: -2 },
      },
      move: "near",
      notes: "<p><i>A probe brute.</i></p>",
    },
    items: [
      {
        name: "Greatclub",
        type: "NPC Attack",
        system: {
          attack: { num: 2 },
          bonuses: { attackBonus: 6 },
          damage: { value: "2d6", special: "" },
          ranges: ["close"],
          description: "",
        },
      },
      {
        name: "Trample",
        type: "NPC Feature",
        system: { description: "<p>Knocks a target prone.</p>" },
      },
    ],
  };
}

async function deleteFixtureActors() {
  for (const actor of game.actors.filter((a) => (a.name ?? "").startsWith(FIXTURE_PREFIX))) {
    const strays = canvas.scene?.tokens?.filter((t) => t.actorId === actor.id).map((t) => t.id) ?? [];
    if (strays.length) await canvas.scene.deleteEmbeddedDocuments("Token", strays);
    await actor.delete();
  }
}

export function registerCreatorUpdateBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.creator-update", (context) => {
    const { describe, it, assert, before, after } = context;

    let app = null;
    let savedState = null;

    before(async function () {
      this.timeout(60000);
      if (!game.user.isGM) this.skip();
      await deleteFixtureActors();          // self-heal a crashed prior run

      app = MonsterCreator.instance;
      // The singleton carries the GM's live draft — stash everything this
      // batch touches so after() can put it back exactly.
      savedState = {
        draft: foundry.utils.deepClone(app._draft),
        sourceRef: app._sourceRef ? { ...app._sourceRef } : null,
        sectionOpen: { ...app._sectionOpen },
      };
    });

    after(async function () {
      this.timeout(60000);
      if (savedState && app) {
        app._draft = savedState.draft;
        app._sourceRef = savedState.sourceRef;
        app._sectionOpen = savedState.sectionOpen;
      }
      await deleteFixtureActors();
    });

    /** Fresh fixture actor with the draft loaded and the source linked. */
    async function loadFixture(suffix) {
      const actor = await Actor.implementation.create(fixtureActorData(`${FIXTURE_PREFIX} ${suffix}`));
      app._draft = await actorToDraft(actor);
      app._sourceRef = { uuid: actor.uuid, name: actor.name, isToken: false };
      return actor;
    }

    describe("update in place", function () {
      it("writes back to the same actor instead of creating a duplicate", async function () {
        this.timeout(60000);
        const actor = await loadFixture("InPlace");
        const before = game.actors.size;

        app._draft.ac = 14;
        app._draft.hp = { value: 40, max: 40 };
        await app._onSave();

        assert.equal(game.actors.size, before, "no new world actor was created");
        const fresh = game.actors.get(actor.id);
        assert.ok(fresh, "the original actor still exists");
        assert.equal(fresh.system.attributes.ac.value, 14, "AC was written through");
        assert.equal(fresh.system.attributes.hp.max, 40, "HP was written through");
        assert.ok(app._sourceRef, "the draft stays linked for further edits");
      });

      it("keeps the item id of an untouched attack", async function () {
        this.timeout(60000);
        const actor = await loadFixture("ItemId");
        const originalId = actor.items.find((i) => i.type === "NPC Attack").id;

        // Change something else entirely; the attack is untouched.
        app._draft.description = "Edited description.";
        await app._onSave();

        const fresh = game.actors.get(actor.id);
        const attack = fresh.items.find((i) => i.type === "NPC Attack");
        assert.ok(attack, "the attack survived the update");
        assert.equal(
          attack.id, originalId,
          "reconciliation matched by (type, name) — a wipe-and-recreate would break the quick-adjust backup",
        );
      });

      it("adds a new feature without disturbing the existing one", async function () {
        this.timeout(60000);
        const actor = await loadFixture("AddFeature");
        const trampleId = actor.items.find((i) => i.name === "Trample").id;

        app._draft.features.push({
          id: foundry.utils.randomID(),
          name: "Bone Crusher",
          description: "On a crit, the target is knocked prone.",
        });
        await app._onSave();

        const fresh = game.actors.get(actor.id);
        const features = fresh.items.filter((i) => i.type === "NPC Feature");
        assert.equal(features.length, 2, "exactly one feature was added");
        assert.ok(features.some((f) => f.name === "Bone Crusher"), "the new feature landed");
        assert.equal(
          fresh.items.get(trampleId)?.name, "Trample",
          "the pre-existing feature kept its identity",
        );
      });

      it("deletes the old item when a draft entry is renamed", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Rename");

        const feature = app._draft.features.find((f) => f.name === "Trample");
        feature.name = "Stampede";
        await app._onSave();

        const fresh = game.actors.get(actor.id);
        const names = fresh.items.filter((i) => i.type === "NPC Feature").map((i) => i.name);
        assert.deepEqual(names, ["Stampede"], "renamed, not accumulated as an orphan pair");
      });

      it("removes items dropped from the draft", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Remove");

        app._draft.features = [];
        await app._onSave();

        const fresh = game.actors.get(actor.id);
        assert.equal(
          fresh.items.filter((i) => i.type === "NPC Feature").length, 0,
          "the dropped feature was deleted from the actor",
        );
        assert.equal(
          fresh.items.filter((i) => i.type === "NPC Attack").length, 1,
          "unrelated item types were not swept up",
        );
      });

      it("leaves item types the Creator does not author alone", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Untouched");

        // Pick any Item type outside the four the Creator manages.
        const MANAGED = new Set(["NPC Attack", "NPC Special Attack", "NPC Feature", "Spell"]);
        const spare = (game.documentTypes?.Item ?? []).find(
          (t) => !MANAGED.has(t) && !t.startsWith("base"),
        );
        if (!spare) this.skip();

        const [extra] = await actor.createEmbeddedDocuments("Item", [
          { name: `${FIXTURE_PREFIX} Bystander`, type: spare },
        ]);
        // Reload so the draft reflects the actor as it now stands.
        app._draft = await actorToDraft(actor);
        app._sourceRef = { uuid: actor.uuid, name: actor.name, isToken: false };

        app._draft.ac = 12;
        await app._onSave();

        const fresh = game.actors.get(actor.id);
        assert.ok(
          fresh.items.get(extra.id),
          `a ${spare} item survived the update untouched (only the four authored types are reconciled)`,
        );
      });

      it("rebuilds the printed stat block to match the new data", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Notes");

        app._draft.level = 8;
        app._draft.ac = 14;
        app._draft.hp = { value: 40, max: 40 };
        await app._onSave();

        const notes = game.actors.get(actor.id).system.notes ?? "";
        assert.ok(notes.includes("<strong>LV</strong> 8"), `notes show the new level: ${notes}`);
        assert.ok(notes.includes("<strong>AC</strong> 14"), "notes show the new AC");
        assert.ok(notes.includes("<strong>HP</strong> 40"), "notes show the new HP");
      });

      it("clears a stale quick-adjust backup, since Revert would now lie", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Backup");
        await actor.setFlag(MODULE_ID, "quickAdjustBackup", {
          level: 6, ac: 9, hp: { max: 30, value: 30 },
          abilities: {}, notes: "", attacks: {},
        });

        app._draft.ac = 15;
        await app._onSave();

        assert.equal(
          game.actors.get(actor.id).getFlag(MODULE_ID, "quickAdjustBackup"), undefined,
          "the backup flag was dropped by the in-place update",
        );
      });
    });

    describe("save-as-new and stale sources", function () {
      it("Save as New leaves the source untouched", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Fork");
        const originalAc = actor.system.attributes.ac.value;
        const before = game.actors.size;

        app._draft.name = `${FIXTURE_PREFIX} Fork Copy`;
        app._draft.ac = 18;
        await app._onSaveAsNew();

        assert.equal(game.actors.size, before + 1, "exactly one new actor");
        const copy = game.actors.find((a) => a.name === `${FIXTURE_PREFIX} Fork Copy`);
        assert.ok(copy && copy.id !== actor.id, "the copy is a separate actor");
        assert.equal(
          game.actors.get(actor.id).system.attributes.ac.value, originalAc,
          "the source actor was not modified",
        );
        assert.equal(app._sourceRef, null, "save-as-new breaks the link");
      });

      it("falls back to creating when the source actor is gone", async function () {
        this.timeout(60000);
        const actor = await loadFixture("Orphan");
        app._draft.name = `${FIXTURE_PREFIX} Orphan Result`;
        // Delete the source out from under the linked draft.
        await actor.delete();

        const before = game.actors.size;
        await app._onSave();

        assert.equal(game.actors.size, before + 1, "a replacement actor was created");
        assert.ok(
          game.actors.find((a) => a.name === `${FIXTURE_PREFIX} Orphan Result`),
          "the new actor carries the draft's name",
        );
        assert.equal(app._sourceRef, null, "the dead link was cleared");
      });
    });
  });
}
