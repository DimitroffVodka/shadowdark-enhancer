/**
 * Quench batch: crawl ↔ combat state machine — party-population invariants.
 *
 * The push-button version of the manual test that caught the 2026-07-21
 * combat-start duplication (every player token twice in the tracker: the crawl
 * bar's PC-add raced the createCombat auto-enroll, each deduping against a
 * combatant collection the other's in-flight write hadn't reached). Covers all
 * three combat-start flows and asserts the invariant that race broke: after
 * combat starts, every crawl member has EXACTLY ONE combatant.
 *
 * Self-sufficient: with an active crawl it uses the live party (creates and
 * deletes only throwaway Combats — crawl mode round-trips via the deleteCombat
 * hook); with no crawl it builds a disposable two-PC party on the current
 * scene and tears it down. Skips rather than touch a combat that already
 * exists. Registered only via the quenchReady hook (see shadowdark-enhancer.mjs);
 * test/ never ships in the release zip.
 */
import { MODULE_ID }  from "../../scripts/shared/module-id.mjs";
import { CrawlState } from "../../scripts/crawl-strip/crawl-state.mjs";
import { CrawlBar }   from "../../scripts/crawl-bar/crawl-bar.mjs";

const FIXTURE_PREFIX = "Quench SDE PC";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function duplicateTokenIds(combat) {
  const counts = {};
  for (const c of combat.combatants) counts[c.tokenId] = (counts[c.tokenId] ?? 0) + 1;
  return Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id);
}

export function registerCombatStateBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.combat-state", (context) => {
    const { describe, it, assert, before, after, afterEach } = context;

    // Filled by before(): the member tokens on the current scene that every
    // flow asserts against. `fixtures` tracks only what WE created, so
    // teardown can never touch real world data.
    let memberTokens = [];
    const fixtures = { actors: [], tokens: [], startedCrawl: false };

    before(async function () {
      this.timeout(60000);
      // Never touch a live session's combat — skip instead.
      if (game.combat) this.skip();
      if (!canvas.scene) this.skip();
      if (CrawlState.mode === "combat") this.skip();

      // Self-heal fixtures leaked by a crashed prior run.
      const stale = game.actors.filter(a => a.name.startsWith(FIXTURE_PREFIX));
      for (const a of stale) {
        const tokenIds = canvas.scene.tokens.filter(t => t.actorId === a.id).map(t => t.id);
        if (tokenIds.length) await canvas.scene.deleteEmbeddedDocuments("Token", tokenIds);
        await a.delete();
      }

      if (CrawlState.mode === "off") {
        // No live crawl — build a disposable two-PC party on this scene.
        const d = canvas.scene.dimensions;
        for (let i = 0; i < 2; i++) {
          const actor = await Actor.create({ name: `${FIXTURE_PREFIX} ${i + 1}`, type: "Player" });
          fixtures.actors.push(actor.id);
          const td = await actor.getTokenDocument({ x: d.sceneX + i * d.size, y: d.sceneY });
          const [tok] = await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);
          fixtures.tokens.push(tok.id);
        }
        await CrawlState.startCrawl();
        fixtures.startedCrawl = true;
        await CrawlState.addMembers(fixtures.actors);
      }

      memberTokens = canvas.scene.tokens.filter(t => CrawlState.members.includes(t.actorId));
      // A crawl can be active with the party's tokens on another scene — the
      // flows need placeable members here.
      if (!memberTokens.length) this.skip();
    });

    afterEach(async function () {
      this.timeout(30000);
      // A failed assertion leaves its throwaway combat behind. The suite only
      // runs when no combat pre-existed, so any combat present now is ours.
      for (const c of [...game.combats]) await c.delete();
      await sleep(800);
    });

    after(async function () {
      this.timeout(30000);
      for (const id of fixtures.actors) await CrawlState.removeMember(id);
      if (fixtures.startedCrawl) await CrawlState.endCrawl();
      if (fixtures.tokens.length) {
        await canvas.scene.deleteEmbeddedDocuments("Token", fixtures.tokens);
      }
      for (const id of fixtures.actors) await game.actors.get(id)?.delete();
    });

    describe("combat start populates the party exactly once", function () {
      it("crawl bar Start Combat: every member once, noAutoEnroll stamped", async function () {
        this.timeout(60000);
        canvas.tokens.releaseAll(); // a stray selection would add extra combatants
        await CrawlBar._startCombat();
        await sleep(2500);
        const combat = game.combat;
        assert.exists(combat, "no combat after _startCombat");
        assert.deepEqual(duplicateTokenIds(combat), [], "duplicate combatants");
        assert.isTrue(combat.flags?.[MODULE_ID]?.noAutoEnroll === true, "noAutoEnroll flag missing");
        for (const t of memberTokens) {
          assert.isTrue(combat.combatants.some(c => c.tokenId === t.id), `${t.name} missing from combat`);
        }
        await combat.delete();
        await sleep(800);
        assert.equal(CrawlState.mode, "crawl", "mode did not return to crawl after combat ended");
      });

      it("external combat (toggle pattern): auto-enroll adds every member once", async function () {
        this.timeout(60000);
        const combat = await Combat.create({ scene: canvas.scene.id });
        await sleep(3000);
        assert.deepEqual(duplicateTokenIds(combat), [], "duplicate combatants");
        for (const t of memberTokens) {
          assert.isTrue(combat.combatants.some(c => c.tokenId === t.id), `${t.name} not auto-enrolled`);
        }
        await combat.delete();
        await sleep(800);
        assert.equal(CrawlState.mode, "crawl", "mode did not return to crawl after combat ended");
      });

      it("external combat with a member pre-toggled: self-heals to one combatant per token", async function () {
        this.timeout(60000);
        const pre = memberTokens[0];
        const combat = await Combat.create({ scene: canvas.scene.id });
        await combat.createEmbeddedDocuments("Combatant", [
          { tokenId: pre.id, sceneId: canvas.scene.id, hidden: pre.hidden },
        ]);
        await sleep(3000);
        assert.deepEqual(duplicateTokenIds(combat), [], "duplicate combatants survived the self-heal");
        for (const t of memberTokens) {
          assert.isTrue(combat.combatants.some(c => c.tokenId === t.id), `${t.name} missing from combat`);
        }
        await combat.delete();
        await sleep(800);
        assert.equal(CrawlState.mode, "crawl", "mode did not return to crawl after combat ended");
      });
    });
  }, { displayName: "Shadowdark Enhancer: combat state machine — party population" });
}
