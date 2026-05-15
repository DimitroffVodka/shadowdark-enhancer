import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";

/**
 * Out-of-combat initiative for crawl rounds.
 *
 * Rolls 1d20 + actor.system.roll.initiative.bonus with the actor's advantage
 * applied via shadowdark.dice.applyAdvantage. Posts the roll through
 * Roll#toMessage so it appears as a normal chat card and Dice So Nice
 * picks up the 3D roll — same pipeline as a combat initiative roll.
 *
 * Result is stored on CrawlState.oocInitiative keyed by tokenId. The strip's
 * card sort honors it; cleared by CrawlState.clearOocInitiative() (Reset Init
 * button on the bar).
 */
export const InitiativeManager = {

  /**
   * Roll for one token. Caller is responsible for permission checks if needed;
   * non-GM callers must be the actor owner.
   */
  async rollOocForToken(tokenId) {
    const token = canvas.scene?.tokens.get(tokenId);
    const actor = token?.actor;
    if (!actor) return null;
    if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) return null;

    const { roll, advantage } = await this._rollFor(actor);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} rolls Initiative <em>(out of combat)</em>`,
    });
    await CrawlState.setOocInitiative(tokenId, { roll: roll.total, advantage });
    return roll.total;
  },

  /**
   * Roll for every Player token on the active scene whose tokenId isn't
   * already in CrawlState.oocInitiative. Non-GM rolls only for owned tokens.
   */
  async rollOocForAll() {
    const tokens = canvas.scene?.tokens?.contents ?? [];
    const candidates = tokens.filter(t => {
      const actor = t.actor;
      if (!actor || actor.type !== "Player") return false;
      if (CrawlState.oocInitiative[t.id]) return false;
      if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) return false;
      return true;
    });
    if (candidates.length === 0) {
      ui.notifications.info("Shadowdark Enhancer: nothing to roll.");
      return;
    }
    for (const token of candidates) {
      await this.rollOocForToken(token.id);
    }
  },

  // ── Internal ──────────────────────────────────────────────────────────────

  async _rollFor(actor) {
    const bonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
    const advantage = Number(actor.system?.roll?.initiative?.advantage ?? 0);

    const baseFormula = "1d20";
    const advFn = globalThis.shadowdark?.dice?.applyAdvantage;
    const formula = (advantage !== 0 && typeof advFn === "function")
      ? advFn(baseFormula, advantage)
      : baseFormula;
    const full = bonus !== 0 ? `${formula} + ${bonus}` : formula;

    const roll = await new Roll(full).roll();
    return { roll, advantage };
  },
};
