/**
 * Quench batch: temp HP in front of HP, and stat damage — real Actor semantics.
 *
 * The node tests stub Actor, so they cannot see what the live document does
 * with the flag write, the HP write and the effect writes. This drives the
 * REAL ActorSD.applyDamage (with the temp HP wrapper installed on ready) and
 * StatDamage on a throwaway Player, and reads the state back from the document.
 *
 * Self-sufficient: the fixture actor carries this batch's own flag, before()
 * removes flagged leftovers of a crashed run, after() deletes only the actor
 * this run made. An actor without the flag is never touched, whatever its name.
 * Registered only via quenchReady (see shadowdark-enhancer.mjs); test/ never
 * ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";
import { setTempHp, tempHpOf } from "../../scripts/shared/temp-hp.mjs";
import { StatDamage } from "../../scripts/stat-damage/stat-damage.mjs";

const BATCH = "shadowdark-enhancer.temp-hp-stat-damage";
const FIXTURE_NAME = "Quench SDE TempHP PC";
const isFixture = (actor) => actor.flags?.[MODULE_ID]?.quenchFixture === BATCH;
const hpOf = (actor) => actor.system.attributes.hp.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the document shows `check`, up to `ms`. The system's applyDamage resolves before its
 * HP write lands, and that write can take any time, so a test waits for the state it expects and
 * then asserts; a wrong state still fails, only after the wait.
 */
async function settled(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (check()) return;
}

async function deleteFixtures() {
  for (const a of game.actors.filter(isFixture)) await a.delete();
}

export function registerTempHpStatDamageBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.temp-hp-stat-damage", (context) => {
    const { describe, it, assert, before, after, beforeEach } = context;
    let actor = null;

    before(async function () {
      this.timeout(30000);
      await deleteFixtures();
      actor = await Actor.create({ name: FIXTURE_NAME, type: "Player", flags: { [MODULE_ID]: { quenchFixture: BATCH } } });
    });

    after(async function () {
      this.timeout(30000);
      if (actor) await game.actors.get(actor.id)?.delete();
    });

    // Every test starts from the same state: HP 10 of 10, no pool and no stat damage.
    beforeEach(async function () {
      this.timeout(15000);
      await actor.update({ "system.attributes.hp.base": 10, "system.attributes.hp.value": 10 });
      await setTempHp(actor, 0);
      await StatDamage.heal(actor, { all: true });
      await settled(() => hpOf(actor) === 10);
      assert.equal(hpOf(actor), 10, "fixture could not be put at 10 HP");
    });

    describe("temp HP", function () {
      it("takes the whole hit when it is big enough", async function () {
        this.timeout(15000);
        await setTempHp(actor, 5);
        await actor.applyDamage(3, 1);
        await settled(() => tempHpOf(actor) === 2);
        assert.equal(hpOf(actor), 10);
        assert.equal(tempHpOf(actor), 2);
      });

      it("passes the rest to HP when the pool runs out", async function () {
        this.timeout(15000);
        await setTempHp(actor, 2);
        await actor.applyDamage(5, 1);
        await settled(() => tempHpOf(actor) === 0 && hpOf(actor) === 7);
        assert.equal(tempHpOf(actor), 0);
        assert.equal(hpOf(actor), 7);
      });

      it("ignores a pool that has expired", async function () {
        this.timeout(15000);
        await setTempHp(actor, 5, { expires: game.time.worldTime - 10 });
        assert.equal(tempHpOf(actor), 0);
        await actor.applyDamage(3, 1);
        await settled(() => hpOf(actor) === 7);
        assert.equal(hpOf(actor), 7);
      });

      it("does not touch the pool when the actor is healed", async function () {
        this.timeout(15000);
        await actor.update({ "system.attributes.hp.value": 4 });
        await setTempHp(actor, 5);
        await actor.applyDamage(2, -1);
        await settled(() => hpOf(actor) === 6);
        assert.equal(tempHpOf(actor), 5);
        assert.equal(hpOf(actor), 6);
      });
    });

    describe("stat damage", function () {
      it("adds up per ability and reads back from the effects", async function () {
        this.timeout(15000);
        await StatDamage.apply(actor, "str", 2);
        await StatDamage.apply(actor, "str", 1);
        assert.equal(StatDamage.of(actor).str, 3);
        assert.equal(StatDamage.of(actor).dex, 0);
      });

      it("heals one point per damaged ability, then the rest", async function () {
        this.timeout(15000);
        await StatDamage.apply(actor, "str", 2);
        await StatDamage.apply(actor, "wis", 1);
        await StatDamage.heal(actor, { perAbility: 1 });
        assert.equal(StatDamage.of(actor).str, 1);
        assert.equal(StatDamage.of(actor).wis, 0);
        await StatDamage.heal(actor, { all: true });
        assert.equal(StatDamage.of(actor).str, 0);
      });

      it("leaves no stray effects behind once healed", async function () {
        this.timeout(15000);
        await StatDamage.apply(actor, "int", 2);
        await StatDamage.heal(actor, { all: true });
        await settled(() => !actor.effects.some((e) => e.flags?.[MODULE_ID]));
        assert.equal(actor.effects.filter((e) => e.flags?.[MODULE_ID]).length, 0);
      });
    });
  });
}
