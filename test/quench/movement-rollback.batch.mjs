/**
 * Quench batch: movement budget + turn-start rollback — accounting invariants.
 *
 * Exercises the crawl-mode movement pipeline end to end on a real token:
 *   - budget accounting: after a legal move, moveRemaining = budget − distance
 *     (the "remaining + spent = full budget" invariant, exact on a 5 ft grid);
 *   - refusal: a move beyond the remaining budget is cancelled in
 *     preUpdateToken — position AND budget stay untouched;
 *   - rollback: MovementTracker.rollback() displaces the token back to the
 *     turnStart snapshot (v14 displace-waypoint path) and refunds the full
 *     budget.
 *
 * Self-sufficient: builds a one-PC crawl party when none is active, saves and
 * restores the enforcement settings it flips, deletes only its own fixtures.
 * Skips on non-square / non-5ft grids (distance math would need the scene's
 * diagonal rule) and never touches a live combat. Registered only via
 * quenchReady; test/ never ships in the release zip.
 */
import { MODULE_ID } from "../../scripts/shared/module-id.mjs";
import { CrawlState } from "../../scripts/crawl-strip/crawl-state.mjs";
import { MovementTracker } from "../../scripts/crawl-strip/movement-tracker.mjs";

const FIXTURE_PREFIX = "Quench SDE Mover";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn() is truthy or timeout — flag writes trail the update hook. */
async function waitFor(fn, { timeout = 4000, every = 100 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(every);
  }
  return fn();
}

export function registerMovementRollbackBatch(quench) {
  quench.registerBatch("shadowdark-enhancer.movement-rollback", (context) => {
    const { describe, it, assert, before, after } = context;

    const fixtures = { actors: [], tokens: [], startedCrawl: false };
    const savedSettings = {};
    let tokenDoc = null;
    let budget = 0;      // oocMovementBudget (crawl-mode budget for everyone)
    let gridFt = 5;
    let gridPx = 100;

    before(async function () {
      this.timeout(60000);
      if (!game.user.isGM) this.skip();
      if (!canvas.scene) this.skip();
      if (game.combat) this.skip();
      if (CrawlState.mode === "combat") this.skip();
      // Exact-distance assertions need a plain square 5 ft grid.
      if (canvas.scene.grid.type !== CONST.GRID_TYPES.SQUARE) this.skip();
      if (canvas.scene.grid.distance !== 5) this.skip();

      // Self-heal fixtures leaked by a crashed prior run.
      const stale = game.actors.filter((a) => a.name.startsWith(FIXTURE_PREFIX));
      for (const a of stale) {
        const ids = canvas.scene.tokens.filter((t) => t.actorId === a.id).map((t) => t.id);
        if (ids.length) await canvas.scene.deleteEmbeddedDocuments("Token", ids);
        await a.delete();
      }

      savedSettings.oocEnforceBudget = game.settings.get(MODULE_ID, "oocEnforceBudget");
      await game.settings.set(MODULE_ID, "oocEnforceBudget", true);
      budget = game.settings.get(MODULE_ID, "oocMovementBudget");
      assert.isAtLeast(budget, 15, "oocMovementBudget too small for the test moves");

      const d = canvas.scene.dimensions;
      gridPx = canvas.scene.grid.size;
      gridFt = canvas.scene.grid.distance;
      const actor = await Actor.create({ name: `${FIXTURE_PREFIX} 1`, type: "Player" });
      fixtures.actors.push(actor.id);
      const td = await actor.getTokenDocument({ x: d.sceneX, y: d.sceneY });
      const [tok] = await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);
      fixtures.tokens.push(tok.id);
      tokenDoc = tok;

      if (CrawlState.mode === "off") {
        await CrawlState.startCrawl();
        fixtures.startedCrawl = true;
      }
      await CrawlState.addMembers(fixtures.actors);
    });

    after(async function () {
      this.timeout(60000);
      for (const id of fixtures.actors) await CrawlState.removeMember(id);
      if (fixtures.startedCrawl) await CrawlState.endCrawl();
      if (fixtures.tokens.length) await canvas.scene.deleteEmbeddedDocuments("Token", fixtures.tokens);
      for (const id of fixtures.actors) await game.actors.get(id)?.delete();
      if (savedSettings.oocEnforceBudget !== undefined) {
        await game.settings.set(MODULE_ID, "oocEnforceBudget", savedSettings.oocEnforceBudget);
      }
    });

    describe("crawl-mode budget, refusal, rollback", function () {
      it("turn reset stamps full budget + turnStart snapshot on the DOCUMENT", async function () {
        this.timeout(30000);
        await MovementTracker.resetToken(tokenDoc);
        assert.equal(tokenDoc.getFlag(MODULE_ID, "moveRemaining"), Math.round(budget / 5) * 5,
          "moveRemaining not initialized to the crawl budget");
        const start = tokenDoc.getFlag(MODULE_ID, "turnStart");
        assert.exists(start, "turnStart snapshot missing (multi-GM rollback needs it on the doc)");
        assert.equal(start.x, tokenDoc._source.x);
        assert.equal(start.y, tokenDoc._source.y);
      });

      it("a legal move deducts exactly its distance: remaining + spent = budget", async function () {
        this.timeout(30000);
        const remBefore = tokenDoc.getFlag(MODULE_ID, "moveRemaining");
        await tokenDoc.update({ x: tokenDoc._source.x + 2 * gridPx });   // 2 squares east = 10 ft
        const remAfter = await waitFor(() => {
          const r = tokenDoc.getFlag(MODULE_ID, "moveRemaining");
          return r !== remBefore ? r : null;
        });
        const spent = 2 * gridFt;
        assert.equal(remAfter, remBefore - spent, "deduction ≠ distance moved");
        assert.equal(remAfter + spent, Math.round(budget / 5) * 5,
          "remaining + spent no longer equals the full budget");
      });

      it("a move beyond the remaining budget is refused — position and budget untouched", async function () {
        this.timeout(30000);
        const remBefore = tokenDoc.getFlag(MODULE_ID, "moveRemaining");
        const xBefore = tokenDoc._source.x;
        const tooFarSquares = Math.ceil(remBefore / gridFt) + 2;
        await tokenDoc.update({ x: xBefore + tooFarSquares * gridPx });
        await sleep(600);
        assert.equal(tokenDoc._source.x, xBefore, "refused move still displaced the token");
        assert.equal(tokenDoc.getFlag(MODULE_ID, "moveRemaining"), remBefore,
          "refused move still spent budget");
      });

      it("rollback returns the token to turnStart and refunds the full budget", async function () {
        this.timeout(30000);
        const start = tokenDoc.getFlag(MODULE_ID, "turnStart");
        assert.notEqual(tokenDoc._source.x, start.x, "token never left its start square");
        await MovementTracker.rollback(tokenDoc.id);
        await waitFor(() => tokenDoc._source.x === start.x);
        assert.equal(tokenDoc._source.x, start.x, "rollback missed the turn-start x");
        assert.equal(tokenDoc._source.y, start.y, "rollback missed the turn-start y");
        assert.equal(tokenDoc.getFlag(MODULE_ID, "moveRemaining"), Math.round(budget / 5) * 5,
          "rollback did not refund the full budget");
      });
    });
  }, { displayName: "Shadowdark Enhancer: movement budget + turn-start rollback" });
}
