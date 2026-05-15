import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";

/**
 * Out-of-combat initiative for crawl rounds.
 *
 * Rolls 1d20 + actor.system.roll.initiative.bonus with advantage applied via
 * shadowdark.dice.applyAdvantage, then dispatches through the system's
 * own roll pipeline (`shadowdark.dice.rollFromConfig`) so the chat card uses
 * the Shadowdark style — same look as the system's attack / save / check
 * cards. Dice So Nice picks up the 3D roll automatically.
 *
 * Result is stored on CrawlState.oocInitiative keyed by tokenId; the strip's
 * card sort honors it; cleared by CrawlState.clearOocInitiative() (Reset Init
 * button on the bar) or on startCrawl / endCrawl.
 */
export const InitiativeManager = {

  async rollOocForToken(tokenId) {
    const token = canvas.scene?.tokens.get(tokenId);
    const actor = token?.actor;
    if (!actor) return null;
    if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) return null;

    const dice = globalThis.shadowdark?.dice;
    if (!dice?.rollFromConfig || !dice?.initializeD20Check) {
      // Defensive fallback if the system API isn't available.
      return this._fallbackRoll(actor, tokenId);
    }

    const bonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
    const advantage = Number(actor.system?.roll?.initiative?.advantage ?? 0);
    const baseFormula = "1d20";
    const advFormula = (advantage !== 0 && typeof dice.applyAdvantage === "function")
      ? dice.applyAdvantage(baseFormula, advantage)
      : baseFormula;
    const formula = bonus !== 0 ? `${advFormula} + ${bonus}` : advFormula;

    const config = dice.initializeD20Check({
      actorId: actor.id,
      mainRoll: { formula },
      type: "initiative",
      heading: `${actor.name} — Initiative <em>(out of combat)</em>`,
    });

    const mainRoll = await dice.rollFromConfig(config);
    if (!mainRoll) return null;

    const total = mainRoll?.roll?.total ?? mainRoll?.total;
    if (typeof total === "number") {
      await CrawlState.setOocInitiative(tokenId, { roll: total, advantage });
    }
    return total ?? null;
  },

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

  async _fallbackRoll(actor, tokenId) {
    const bonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
    const advantage = Number(actor.system?.roll?.initiative?.advantage ?? 0);
    const advFn = globalThis.shadowdark?.dice?.applyAdvantage;
    const baseFormula = "1d20";
    const advFormula = (advantage !== 0 && typeof advFn === "function")
      ? advFn(baseFormula, advantage) : baseFormula;
    const full = bonus !== 0 ? `${advFormula} + ${bonus}` : advFormula;

    const roll = await new Roll(full).evaluate();
    const content = await roll.render();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} rolls Initiative <em>(out of combat)</em>
        <strong class="sde-chat-init-total">${roll.total}</strong>`,
      content,
    });
    await CrawlState.setOocInitiative(tokenId, { roll: roll.total, advantage });
    return roll.total;
  },
};
