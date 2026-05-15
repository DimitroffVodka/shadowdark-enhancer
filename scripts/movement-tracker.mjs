import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";

const FLAG_TURN_START = "turnStart";
const FLAG_CRAWL_ANCHOR = "crawlAnchor";

export const MovementTracker = {
  init() {
    // Capture turn-start positions for every combatant when combat begins.
    Hooks.on("combatStart", async (combat) => {
      if (!game.user.isGM) return;
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this._setFlag(tokenDoc, FLAG_TURN_START, { x: tokenDoc.x, y: tokenDoc.y });
      }
    });

    // Refresh active combatant's turn-start on each turn change.
    Hooks.on("combatTurn", async (combat) => {
      if (!game.user.isGM) return;
      const c = combat.combatant;
      const tokenDoc = c?.token;
      if (!tokenDoc) return;
      await this._setFlag(tokenDoc, FLAG_TURN_START, { x: tokenDoc.x, y: tokenDoc.y });
    });

    // Clear all turn-start flags when combat ends.
    Hooks.on("deleteCombat", async (combat) => {
      if (!game.user.isGM) return;
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this._clearFlag(tokenDoc, FLAG_TURN_START);
      }
    });

    // OoC enforcement: refuse moves that would push a PC token past its crawl budget.
    Hooks.on("preUpdateToken", (tokenDoc, changes) => {
      // Only act on position changes.
      if (!("x" in changes) && !("y" in changes)) return;
      // Only in crawl mode.
      if (CrawlState.mode !== "crawl") return;
      // Only if enforcement is enabled.
      if (!game.settings.get(MODULE_ID, "oocEnforceBudget")) return;
      // Only PC tokens.
      if (tokenDoc.actor?.type !== "Player") return;

      const anchor = tokenDoc.flags?.[MODULE_ID]?.[FLAG_CRAWL_ANCHOR];
      if (!anchor) return;   // no anchor yet → no enforcement

      const proposed = {
        x: changes.x ?? tokenDoc.x,
        y: changes.y ?? tokenDoc.y,
      };
      const proposedDist = this._gridDistance(anchor, proposed);
      const budget = this.budgetFor("crawl");

      if (proposedDist > budget) {
        ui.notifications.warn(
          `${tokenDoc.actor?.name ?? "Token"}: crawl movement budget exceeded (${proposedDist}/${budget} ft).`
        );
        return false;   // cancel the update
      }
    });
  },

  /**
   * Grid-Chebyshev distance (in feet) from the configured origin to the
   * token's current position.
   * @param {TokenDocument} tokenDoc
   * @param {"combat"|"crawl"} mode
   * @returns {number}
   */
  usedFor(tokenDoc, mode) {
    const flagKey = mode === "combat" ? FLAG_TURN_START : FLAG_CRAWL_ANCHOR;
    const origin = tokenDoc?.flags?.[MODULE_ID]?.[flagKey];
    if (!origin) return 0;
    return this._gridDistance(origin, { x: tokenDoc.x, y: tokenDoc.y });
  },

  budgetFor(mode) {
    return mode === "combat"
      ? game.settings.get(MODULE_ID, "combatMovementDefault")
      : game.settings.get(MODULE_ID, "oocMovementBudget");
  },

  /**
   * Move the token back to its captured turn-start coordinates.
   * No-op + warning notification if no flag set.
   */
  async rollbackToTurnStart(tokenDoc) {
    const origin = tokenDoc?.flags?.[MODULE_ID]?.[FLAG_TURN_START];
    if (!origin) {
      ui.notifications.warn("Shadowdark Enhancer: no turn-start recorded for this token.");
      return;
    }
    await tokenDoc.update({ x: origin.x, y: origin.y });
    ui.notifications.info(`${tokenDoc.actor?.name ?? "Token"} rolled back to turn start.`);
  },

  /**
   * Task 10 will call these. Stubs included so crawl-state.mjs and other
   * callers don't have to import-guard.
   */
  async captureCrawlAnchors() {
    if (!game.user.isGM) return;
    const tokens = canvas.scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await this._setFlag(t, FLAG_CRAWL_ANCHOR, { x: t.x, y: t.y });
    }
  },

  async clearCrawlAnchors() {
    if (!game.user.isGM) return;
    const tokens = canvas.scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await this._clearFlag(t, FLAG_CRAWL_ANCHOR);
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
    // Chebyshev distance in grid squares × scene grid distance (ft per square).
    const gridSize = canvas.scene?.grid?.size ?? 100;
    const distFt = canvas.scene?.grid?.distance ?? 5;
    const dx = Math.abs(a.x - b.x) / gridSize;
    const dy = Math.abs(a.y - b.y) / gridSize;
    const squares = Math.max(dx, dy);
    return Math.round(squares * distFt);
  },
};
