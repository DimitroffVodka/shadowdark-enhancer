/**
 * Shadowdark Enhancer — Movement Tracker
 *
 * Faithful port of vagabond-crawler/scripts/movement-tracker.mjs adapted for
 * Shadowdark's data model.
 *
 * Crawl mode: hard-blocks movement beyond crawl budget (when enforcement on).
 * Combat mode: budget = combat speed; ruler turns red when over.
 *              Floors at 0 (no Rush mechanic in Shadowdark).
 *
 * Adaptations from Vagabond:
 *   - No per-actor speed: budget is module-setting-driven (combatMovementDefault / oocMovementBudget).
 *   - No Rush, no overloaded check, no terrain difficulty regions.
 *   - No fly/swim/climb effective-mode resolution.
 *   - Actor types are "Player" and "NPC" (capitalized).
 *   - CrawlState.members is [tokenId, ...] (array of strings), NOT objects.
 *   - CrawlState mode flags: `CrawlState.mode === "combat"` replaces Vagabond's `paused`.
 *   - moveRemaining is stored on the TOKEN (not actor) — members are tracked by tokenId
 *     and the same actor may have multiple tokens.
 *
 * TokenRulerWaypoint (what _getSegmentStyle receives) is NOT the same
 * object as the TokenMeasuredMovementWaypoint passed to refresh().
 * Foundry creates new DeepReadonly<TokenRulerWaypoint> objects internally
 * with `previous` (linked list), `stage` ("passed"|"pending"|"planned"),
 * and `cost` carried over from the original waypoint.
 *
 * We compute cumulative cost by walking the `previous` chain, counting
 * only "pending" waypoints (passed costs are already deducted from the
 * token's moveRemaining flag).
 */

import { MODULE_ID }  from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { ICONS }      from "./icons.mjs";

// ── Shared speed helpers ────────────────────────────────────────────────────

/**
 * Maps the Shadowdark NPC move enum (`actor.system.move`) to feet per turn.
 * Values from `shadowdark.config.NPC_MOVES`: none / close / near / doubleNear /
 * tripleNear / far / special.
 *
 *   close       → 5 ft  (Shadowdark "Close")
 *   near        → 30 ft (one move)
 *   doubleNear  → 60 ft
 *   tripleNear  → 90 ft
 *   far         → 120 ft ("very long distance per turn")
 *   special     → null  (no fixed feet; caller falls back to combat default)
 *   none        → 0 ft  (immobile)
 *
 * Returns null when the value isn't recognized so callers can fall back.
 */
function _npcMoveToFt(moveValue) {
  if (typeof moveValue !== "string") return null;
  switch (moveValue) {
    case "none":       return 0;
    case "close":      return 5;
    case "near":       return 30;
    case "doubleNear": return 60;
    case "tripleNear": return 90;
    case "far":        return 120;
    case "special":    return null;
  }
  return null;
}

/**
 * Visual movement budget for a token.
 *
 * Combat:
 *   - PC tokens (actor.type === "Player"): `combatMovementDefault` setting (30 ft)
 *   - NPC tokens: parse `actor.system.move` enum to feet; fall back to the
 *     combat default for `special` / unknown / missing values.
 * Crawl:
 *   - All tokens: `oocMovementBudget` setting (90 ft). Crawl pace is
 *     overland; NPCs in the crawl roster (rare) keep pace with the party.
 */
function _getBaseSpeed(actor, tokenDoc = null) {
  if (!actor) return 0;
  const inCombat = CrawlState.mode === "combat";

  if (!inCombat) {
    return game.settings.get(MODULE_ID, "oocMovementBudget");
  }

  // Combat — NPCs use their per-statblock move
  if (actor.type === "NPC") {
    const ft = _npcMoveToFt(actor.system?.move);
    if (typeof ft === "number") return ft;
    // Special / unknown / missing → combat default
  }

  return game.settings.get(MODULE_ID, "combatMovementDefault");
}

// Terrain difficulty support deferred — always 1× until Shadowdark gets a
// region-based terrain system worth integrating with.

// ── SDE TokenRuler subclass ─────────────────────────────────────────────────

class SDETokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {

  // ── Helpers ──────────────────────────────────────────────────────────────

  get _moveRemaining() {
    const doc = this.token?.document;
    const actor = this.token?.actor;
    if (!doc || !actor) return Infinity;
    const stored = doc.getFlag(MODULE_ID, "moveRemaining");
    return (typeof stored === "number") ? stored : _getBaseSpeed(actor, doc);
  }

  get _isTracked() {
    if (!CrawlState.isActive) return false;
    const doc = this.token?.document;
    if (!doc) return false;
    return CrawlState.members.includes(doc.id);
  }

  /**
   * Walk the waypoint's `previous` linked list and sum costs of pending
   * waypoints only.  Passed waypoints have already been deducted from the
   * token's moveRemaining flag, so including them would double-count.
   */
  _cumulativeAt(waypoint) {
    let total = 0;
    let wp = waypoint;
    while (wp) {
      if (wp.stage === "passed") break;   // stop at committed waypoints
      total += (wp.cost ?? 0);
      wp = wp.previous ?? null;
    }
    return total;
  }

  _colorForFt(ft) {
    const r = this._moveRemaining;
    return ft <= r ? 0x00cc00 : 0xcc2200;  // green: within budget, red: over
  }

  _clearHighlight() {
    const layerName = `TokenRuler.${this.token.id}`;
    canvas.interface.grid.clearHighlightLayer(layerName);
  }

  clear() {
    this._clearHighlight();
    super.clear();
  }

  // ── refresh ────────────────────────────────────────────────────────────

  /** No custom bookkeeping needed — style methods walk the linked list. */
  refresh(args) {
    super.refresh(args);
  }

  // ── Style overrides ────────────────────────────────────────────────────

  _getSegmentStyle(waypoint) {
    const base = super._getSegmentStyle(waypoint);
    if (!this._isTracked) return base;
    base.color = this._colorForFt(this._cumulativeAt(waypoint));
    return base;
  }

  _getWaypointStyle(waypoint) {
    const base = super._getWaypointStyle(waypoint);
    if (!this._isTracked) return base;
    base.color = this._colorForFt(this._cumulativeAt(waypoint));
    return base;
  }

  _getGridHighlightStyle(waypoint, offset) {
    const base = super._getGridHighlightStyle(waypoint, offset);
    if (!this._isTracked) return base;
    if (this._cumulativeAt(waypoint) > this._moveRemaining) {
      base.color = 0xcc2200;
      base.alpha = Math.min(1, (base.alpha ?? 0.25) * 1.5);
    }
    return base;
  }

  _getWaypointLabelContext(waypoint, state) {
    const base = super._getWaypointLabelContext(waypoint, state);
    if (!this._isTracked || !base) return base;
    const after = this._moveRemaining - this._cumulativeAt(waypoint);
    const tag   = after < 0 ? `OVER: ${after}ft` : `${after}ft left`;
    base.label  = base.label ? `${base.label} (${tag})` : tag;
    return base;
  }
}

// ── MovementTracker ─────────────────────────────────────────────────────────

export const MovementTracker = {

  _turnStartPos: {},   // tokenId → {x, y} snapshotted at turn/round start
  _pendingDeduct: {},  // tokenId → distance feet awaiting deduction
  _clearTimers:   {},  // tokenId → setTimeout handle for ruler clear

  /** Snapshot a token's current position as the rollback target. */
  snapshotPosition(tokenId) {
    const token = canvas.tokens?.get(tokenId);
    if (token) this._turnStartPos[tokenId] = { x: token.document._source.x, y: token.document._source.y };
  },

  init() {
    CONFIG.Token.rulerClass = SDETokenRuler;
    console.log(`${MODULE_ID} | Registered SDETokenRuler`);

    // CONFIG.Token.rulerClass only affects newly created tokens.
    // Swap ruler instances on all tokens already on canvas.
    this._installRulers();
    Hooks.on("canvasReady", () => this._installRulers());

    Hooks.on("preUpdateToken", (doc, changes, opts, userId) => {
      if (opts?.[MODULE_ID]?.rollback) return; // skip accounting for rollback moves
      if (changes.x !== undefined || changes.y !== undefined) {

        // Compute and cache the distance now, while we still have old position.
        // Foundry v14 interpolates doc.x/doc.y mid-animation — use _source for
        // the data-model coords.
        if (CrawlState.isActive) {
          const scene    = doc.parent;
          const gridSize = scene?.grid?.size     ?? 100;
          const gridDist = scene?.grid?.distance ?? 5;
          const oldX = doc._source?.x ?? doc.x;
          const oldY = doc._source?.y ?? doc.y;
          const newX = changes.x ?? oldX;
          const newY = changes.y ?? oldY;
          const dx = (newX - oldX) / gridSize;
          const dy = (newY - oldY) / gridSize;
          // Terrain difficulty deferred — multiplier of 1.
          const distanceFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;
          this._pendingDeduct[doc.id] = distanceFt;
        }
      }
      // Block move if it exceeds remaining movement
      return this._onPreUpdate(doc, changes, userId, this._pendingDeduct[doc.id]);
    });

    Hooks.on("updateToken", (doc, changes, opts) => {
      if (opts?.[MODULE_ID]?.rollback) return;
      if (changes.x !== undefined || changes.y !== undefined) {
        // Deduct movement after the move has successfully committed
        if (CrawlState.isActive) {
          const actor    = doc.actor;
          const isMember = CrawlState.members.includes(doc.id);
          const inCombat = CrawlState.mode === "combat";
          // In combat we also track tokens that aren't crawl members
          // (combatants get added to the combat tracker, not the crawl roster).
          const tracked  = isMember || inCombat;
          if (actor && tracked) {
            const distanceFt = this._pendingDeduct[doc.id] ?? 0;
            delete this._pendingDeduct[doc.id];
            if (distanceFt > 0) {
              const stored = doc.getFlag(MODULE_ID, "moveRemaining");
              const moveRemaining = (typeof stored === "number") ? stored : _getBaseSpeed(actor, doc);
              // No floor at 0 — when the user disables enforcement (combat is
              // off by default), we WANT to record overflow as a negative so
              // the GM can see how far past the soft cap a token moved.
              const newRemaining = Math.round((moveRemaining - distanceFt) / 5) * 5;
              doc.setFlag(MODULE_ID, "moveRemaining", newRemaining)
                .then(() => CrawlStrip.queueRender());
            }
          }
        }

        // Delay ruler clear to after #continueMovement finishes all segments
        const tokenId = doc.id;
        clearTimeout(this._clearTimers[tokenId]);
        this._clearTimers[tokenId] = setTimeout(() => {
          delete this._clearTimers[tokenId];
          const token = canvas.tokens?.get(tokenId);
          token?.ruler?.clear();
          const highlight = canvas.interface.grid.highlight.children
            ?.find(c => c.name === `TokenRuler.${tokenId}`);
          if (highlight) highlight.visible = false;
        }, 100);
      }
    });

    Hooks.on("renderTokenHUD", (hud, html, data) => {
      if (!CrawlState.isActive) return;
      const token = hud.object;
      if (!token?.isOwner) return;
      const tokenDoc = token.document;
      const inCombat = CrawlState.mode === "combat";
      const isMember = CrawlState.members.includes(tokenDoc.id);
      // Show rollback HUD button for crawl members in crawl mode, and for any
      // owned combatant in combat mode.
      if (!isMember && !inCombat) return;

      const root = html instanceof HTMLElement ? html : html?.[0];
      if (!root) return;

      const btn = document.createElement("div");
      btn.classList.add("control-icon");
      btn.title = "Rollback Movement";
      btn.innerHTML = ICONS.rollbackMove;
      btn.addEventListener("click", () => {
        hud.close();
        this.rollback(token.id);
      });
      root.querySelector(".col.left")?.appendChild(btn);
    });

    Hooks.on("controlToken", (token, controlled) => {
      // Clear all rulers when token selection changes — catches any stale ghost trails
      canvas.tokens?.placeables?.forEach(t => {
        if (t.ruler && !t.isMoving) t.ruler.clear();
      });
    });

    Hooks.on("combatStart", async () => {
      if (!CrawlState.isActive || !game.user.isGM) return;
      await this.resetAll();
    });

    Hooks.on("updateCombat", async (combat, changes) => {
      if (!CrawlState.isActive || !game.user.isGM) return;
      // Reset on round change OR turn change (each combatant gets fresh budget)
      if (changes.round === undefined && changes.turn === undefined) return;
      await this.resetAll();
    });

    // Socket relay — players ask GM to perform rollback (turn-start positions
    // are tracked on the GM client).
    game.socket.on(`module.${MODULE_ID}`, (msg) => {
      if (msg?.action === "rollbackMove" && game.user.isGM) {
        this.rollback(msg.tokenId);
      }
    });
  },

  // ── Ruler installation ────────────────────────────────────────────────────

  _installRulers() {
    const tokens = canvas.tokens?.placeables ?? [];
    for (const token of tokens) {
      if (token.ruler instanceof SDETokenRuler) continue;
      try { token.ruler?.destroy(); } catch(e) {}
      token.ruler = new SDETokenRuler(token);
      token.ruler.draw().catch(() => {});
      console.log(`${MODULE_ID} | Installed SDETokenRuler on ${token.name}`);
    }
  },

  // ── preUpdateToken ────────────────────────────────────────────────────────

  _onPreUpdate(doc, changes, userId, precomputedFt) {
    if (!CrawlState.isActive) return;
    if (changes.x === undefined && changes.y === undefined) return;

    const actor = doc.actor;
    if (!actor) return;

    const inCombat = CrawlState.mode === "combat";
    const isMember = CrawlState.members.includes(doc.id);
    if (!isMember && !inCombat) return;

    const enforce = inCombat
      ? game.settings.get(MODULE_ID, "combatEnforceBudget")
      : game.settings.get(MODULE_ID, "oocEnforceBudget");
    if (!enforce) return;

    const stored = doc.getFlag(MODULE_ID, "moveRemaining");
    const moveRemaining = (typeof stored === "number") ? stored : _getBaseSpeed(actor, doc);

    let segFt = precomputedFt;
    if (segFt == null) {
      const scene    = doc.parent;
      const gridSize = scene?.grid?.size     ?? 100;
      const gridDist = scene?.grid?.distance ?? 5;
      const oldX = doc._source?.x ?? doc.x;
      const oldY = doc._source?.y ?? doc.y;
      const newX = changes.x ?? oldX;
      const newY = changes.y ?? oldY;
      const dx = (newX - oldX) / gridSize;
      const dy = (newY - oldY) / gridSize;
      segFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;
    }

    // Shadowdark has no Rush — the cap is just moveRemaining in both modes.
    const limit = moveRemaining;

    if (segFt > limit) {
      delete this._pendingDeduct[doc.id];
      if (userId === game.userId) {
        const msg = `${actor.name}: only ${Math.max(0, moveRemaining)}ft remaining.`;
        ui.notifications.warn(msg);
        // Schedule repeated clear attempts — #continueMovement may redraw after our first clear
        const tokenId = doc.id;
        let attempts = 0;
        const clearLoop = setInterval(() => {
          const token = canvas.tokens?.get(tokenId);
          token?.ruler?.clear();
          const h = canvas.interface?.grid?.highlight?.children
            ?.find(c => c.name === `TokenRuler.${tokenId}`);
          if (h) h.visible = false;
          if (++attempts >= 10) clearInterval(clearLoop);
        }, 50);
      }
      return false;
    }
  },

  // ── Rollback ──────────────────────────────────────────────────────────────

  async rollback(tokenId) {
    // Players relay to GM (turn-start positions are only tracked on the GM client)
    if (!game.user.isGM) {
      game.socket.emit(`module.${MODULE_ID}`, { action: "rollbackMove", tokenId });
      return;
    }
    const start = this._turnStartPos[tokenId];
    if (!start) { ui.notifications.warn("No turn-start position recorded for this token."); return; }

    const token = canvas.tokens?.get(tokenId);
    const doc   = token?.document;
    if (!doc) return;

    const actor = doc.actor;

    // Teleport token back to turn-start position (bypass wall collision)
    await doc.update({ x: start.x, y: start.y }, {
      teleport: true, animate: false, [MODULE_ID]: { rollback: true },
    });

    // Refund full turn movement (base speed — no Rush in Shadowdark)
    if (actor) {
      const fullSpeed = Math.round(_getBaseSpeed(actor, doc) / 5) * 5;
      await doc.setFlag(MODULE_ID, "moveRemaining", fullSpeed);
      CrawlStrip.queueRender();
      ui.notifications.info(`${actor.name} rolled back to turn start — movement restored.`);
    }
  },

  // ── Turn management ───────────────────────────────────────────────────────

  async resetToken(tokenDoc) {
    const actor = tokenDoc?.actor;
    const speed = _getBaseSpeed(actor, tokenDoc);
    await tokenDoc.setFlag(MODULE_ID, "moveRemaining", Math.round(speed / 5) * 5);
  },

  /**
   * Reset moveRemaining + snapshot turn-start for every combatant.
   * Triggered on combatStart and on combat round/turn changes.
   */
  async resetAll() {
    const combat = game.combat;
    if (combat) {
      for (const c of combat.turns) {
        const tokenDoc = c.token;
        if (!tokenDoc) continue;
        await this.resetToken(tokenDoc);
        this._turnStartPos[tokenDoc.id] = {
          x: tokenDoc._source?.x ?? tokenDoc.x,
          y: tokenDoc._source?.y ?? tokenDoc.y,
        };
      }
    }
    CrawlStrip.queueRender();
  },

  /**
   * Reset moveRemaining + snapshot anchor for crawl members.
   * Called from CrawlState.startCrawl / nextCrawlTurn.
   */
  async resetCrawl(tokenIds = null) {
    const ids = tokenIds ?? CrawlState.members;
    const scene = canvas.scene;
    for (const id of ids) {
      const tokenDoc = scene?.tokens.get(id);
      if (!tokenDoc) continue;
      await this.resetToken(tokenDoc);
      this._turnStartPos[id] = {
        x: tokenDoc._source?.x ?? tokenDoc.x,
        y: tokenDoc._source?.y ?? tokenDoc.y,
      };
    }
    CrawlStrip.queueRender();
  },

  // ── Strip read API ────────────────────────────────────────────────────────

  /**
   * Read the stored moveRemaining flag for a token, falling back to the
   * token's effective base speed (which is actor-aware — NPCs use their
   * statblock `system.move`) when no flag is set yet.
   */
  remainingFor(tokenDoc, mode) {
    const stored = tokenDoc?.getFlag?.(MODULE_ID, "moveRemaining");
    if (typeof stored === "number") return stored;
    return this.budgetFor(mode, tokenDoc);
  },

  /**
   * Back-compat shim — used = budget − remaining. Returns 0 when no token.
   */
  usedFor(tokenDoc, mode) {
    if (!tokenDoc) return 0;
    return Math.max(0, this.budgetFor(mode, tokenDoc) - this.remainingFor(tokenDoc, mode));
  },

  /**
   * Movement budget. Actor-aware when a tokenDoc is passed:
   *   - NPCs in combat → parsed from `actor.system.move` (close/near/double/triple/far/etc.)
   *   - PCs / no token → module setting for the mode
   */
  budgetFor(mode, tokenDoc = null) {
    if (tokenDoc?.actor) {
      // _getBaseSpeed reads CrawlState.mode internally; we pass actor+token and trust it
      const ft = _getBaseSpeed(tokenDoc.actor, tokenDoc);
      if (typeof ft === "number") return ft;
    }
    return mode === "combat"
      ? game.settings.get(MODULE_ID, "combatMovementDefault")
      : game.settings.get(MODULE_ID, "oocMovementBudget");
  },

  // ── Crawl-state integration shims ─────────────────────────────────────────
  // CrawlState's startCrawl / nextCrawlTurn / addMembers still call these
  // names from the previous tracker — keep them as aliases for resetCrawl so
  // crawl-state.mjs doesn't need to change its API surface.

  async captureCrawlAnchors() {
    if (!game.user.isGM) return;
    await this.resetCrawl();
  },

  async captureCrawlAnchorsFor(tokenIds) {
    if (!game.user.isGM) return;
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) return;
    await this.resetCrawl(tokenIds);
  },

  async clearCrawlAnchors() {
    if (!game.user.isGM) return;
    const scene = canvas.scene;
    const tokens = scene?.tokens?.contents ?? [];
    for (const t of tokens) {
      await t.unsetFlag(MODULE_ID, "moveRemaining").catch(() => {});
    }
    this._turnStartPos = {};
  },

  /** Rollback helper consumed by the strip's combat-mode rollback action. */
  async rollbackToTurnStart(tokenDoc) {
    if (!tokenDoc) return;
    await this.rollback(tokenDoc.id);
  },
};
