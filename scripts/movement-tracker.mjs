import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";

/**
 * MovementTracker — cumulative path-based movement counter.
 *
 * Each token carries a `usedMovement` flag (feet used since the last reset).
 * Every position change increments it by the grid-Chebyshev distance between
 * old and new position (so moving forward 3 + back 2 = 5 ft used, not 1).
 *
 * Resets:
 *   - crawl mode: startCrawl, nextCrawlTurn, endCrawl (cleared)
 *   - combat mode: combatStart (all combatants); combatTurn (new active only);
 *                  deleteCombat (cleared)
 *
 * Anchors:
 *   - `turnStart` (combat-only) stays as a position record for the
 *     "Rollback to Turn Start" action — distinct from used-movement tracking.
 *   - `crawlAnchor` is retained as a positional record so the strip can still
 *     anchor for visual purposes, but distance computation no longer uses it.
 */

const FLAG_USED         = "usedMovement";
const FLAG_TURN_START   = "turnStart";
const FLAG_CRAWL_ANCHOR = "crawlAnchor";

export const MovementTracker = {
  init() {
    // Combat start — record turn-start positions AND reset usedMovement for all.
    Hooks.on("combatStart", async (combat) => {
      if (!game.user.isGM) return;
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this._setFlag(tokenDoc, FLAG_TURN_START, this._sourcePos(tokenDoc));
        await this._setFlag(tokenDoc, FLAG_USED, 0);
      }
    });

    // Turn change — refresh active combatant's turn-start AND reset their used.
    Hooks.on("combatTurn", async (combat) => {
      if (!game.user.isGM) return;
      const c = combat.combatant;
      const tokenDoc = c?.token;
      if (!tokenDoc) return;
      await this._setFlag(tokenDoc, FLAG_TURN_START, this._sourcePos(tokenDoc));
      await this._setFlag(tokenDoc, FLAG_USED, 0);
    });

    // Combat end — clear turn-start and used for all combatants.
    Hooks.on("deleteCombat", async (combat) => {
      if (!game.user.isGM) return;
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this._clearFlag(tokenDoc, FLAG_TURN_START);
        await this._clearFlag(tokenDoc, FLAG_USED);
      }
    });

    // Position-change tracking + crawl-mode enforcement.
    // preUpdateToken fires BEFORE the commit, so tokenDoc._source still has
    // the old coordinates and `changes` carries the new ones. We compute the
    // delta, decide whether to enforce a budget, and if the move proceeds,
    // schedule the flag increment to land after the current update commits.
    Hooks.on("preUpdateToken", (tokenDoc, changes) => {
      if (!game.user.isGM) return;
      if (!("x" in changes) && !("y" in changes)) return;

      const inCombat = CrawlState.mode === "combat" && !!game.combat;
      const inCrawl  = CrawlState.mode === "crawl";
      if (!inCombat && !inCrawl) return;

      // In combat we only track PCs + NPCs that are combatants; in crawl only PCs.
      if (inCrawl && tokenDoc.actor?.type !== "Player") return;

      const oldPos = this._sourcePos(tokenDoc);
      const newPos = {
        x: changes.x ?? oldPos.x,
        y: changes.y ?? oldPos.y,
      };
      const delta = this._gridDistance(oldPos, newPos);
      if (delta === 0) return;

      const currentUsed = tokenDoc.flags?.[MODULE_ID]?.[FLAG_USED] ?? 0;
      const proposedUsed = currentUsed + delta;

      // Crawl mode enforcement — refuse if the cumulative would exceed budget.
      if (inCrawl && game.settings.get(MODULE_ID, "oocEnforceBudget")) {
        const budget = this.budgetFor("crawl");
        if (proposedUsed > budget) {
          ui.notifications.warn(
            `${tokenDoc.actor?.name ?? "Token"}: crawl movement budget exceeded (${proposedUsed}/${budget} ft).`
          );
          return false;   // cancel the update
        }
      }

      // Schedule the increment to land after this update commits.
      // setFlag inside the same preUpdate would re-enter the hook chain.
      Promise.resolve().then(async () => {
        await this._setFlag(tokenDoc, FLAG_USED, proposedUsed);
      });
    });
  },

  /**
   * Cumulative feet used since the last reset. Reads the flag directly —
   * no anchor distance math.
   */
  usedFor(tokenDoc, /* mode */) {
    return tokenDoc?.flags?.[MODULE_ID]?.[FLAG_USED] ?? 0;
  },

  budgetFor(mode) {
    return mode === "combat"
      ? game.settings.get(MODULE_ID, "combatMovementDefault")
      : game.settings.get(MODULE_ID, "oocMovementBudget");
  },

  /**
   * Move the token back to its captured turn-start coordinates (combat only).
   * Resets usedMovement to 0 since the player is now at the start of their turn.
   */
  async rollbackToTurnStart(tokenDoc) {
    const origin = tokenDoc?.flags?.[MODULE_ID]?.[FLAG_TURN_START];
    if (!origin) {
      ui.notifications.warn("Shadowdark Enhancer: no turn-start recorded for this token.");
      return;
    }
    await tokenDoc.update({ x: origin.x, y: origin.y });
    await this._setFlag(tokenDoc, FLAG_USED, 0);
    ui.notifications.info(`${tokenDoc.actor?.name ?? "Token"} rolled back to turn start.`);
  },

  // Capture crawl baselines for ALL scene tokens; resets usedMovement.
  async captureCrawlAnchors() {
    if (!game.user.isGM) return;
    const tokens = canvas.scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await this._setFlag(t, FLAG_CRAWL_ANCHOR, this._sourcePos(t));
      await this._setFlag(t, FLAG_USED, 0);
    }
  },

  // Capture for specific tokens (used by addMembers).
  async captureCrawlAnchorsFor(tokenIds) {
    if (!game.user.isGM) return;
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) return;
    const scene = canvas.scene;
    for (const id of tokenIds) {
      const t = scene?.tokens.get(id);
      if (!t) continue;
      await this._setFlag(t, FLAG_CRAWL_ANCHOR, this._sourcePos(t));
      await this._setFlag(t, FLAG_USED, 0);
    }
  },

  async clearCrawlAnchors() {
    if (!game.user.isGM) return;
    const tokens = canvas.scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await this._clearFlag(t, FLAG_CRAWL_ANCHOR);
      await this._clearFlag(t, FLAG_USED);
    }
  },

  // ── Internal ───────────────────────────────────────────────────────────
  async _setFlag(tokenDoc, key, value) {
    await tokenDoc.setFlag(MODULE_ID, key, value);
  },

  async _clearFlag(tokenDoc, key) {
    await tokenDoc.unsetFlag(MODULE_ID, key);
  },

  _gridDistance(a, b) {
    const gridSize = canvas.scene?.grid?.size ?? 100;
    const distFt = canvas.scene?.grid?.distance ?? 5;
    const dx = Math.abs(a.x - b.x) / gridSize;
    const dy = Math.abs(a.y - b.y) / gridSize;
    const squares = Math.max(dx, dy);
    return Math.round(squares * distFt);
  },

  _sourcePos(tokenDoc) {
    const src = tokenDoc?._source ?? tokenDoc ?? {};
    return { x: src.x ?? 0, y: src.y ?? 0 };
  },
};
