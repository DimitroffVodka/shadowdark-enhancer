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
 * Reroll handling: we stamp the rollConfig with `sdeOocTokenId` and listen
 * for `createChatMessage`. The system's `rerollFromMessage` reuses the
 * original config to create a NEW message — our hook catches the new total
 * and updates CrawlState.oocInitiative.
 *
 * Result is stored on CrawlState.oocInitiative keyed by tokenId; the strip's
 * card sort honors it; cleared by CrawlState.clearOocInitiative() (Reset Init
 * button on the bar) or on startCrawl / endCrawl.
 */

const CONFIG_TAG = "sdeOocTokenId";

// Watch every new chat message — if its rollConfig carries our token tag,
// the roll is an OoC init roll (or a reroll of one). Sync the total into
// CrawlState so the strip's badge updates.
Hooks.on("createChatMessage", async (msg) => {
  if (!game.user.isGM) return;     // only the GM writes the world setting
  const cfg = msg?.flags?.shadowdark?.rollConfig;
  const tokenId = cfg?.[CONFIG_TAG];
  if (!tokenId) return;
  const total = msg.rolls?.[0]?.total;
  if (typeof total !== "number") return;
  await CrawlState.setOocInitiative(tokenId, { roll: total, advantage: cfg.advantage ?? 0 });
});

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

    // Shadowdark initiative = 1d20 + DEX mod + any extra `roll.initiative.bonus`.
    // Mirrors the system's _ActorBaseSD._modifyRollData formula so OoC rolls match
    // what `combatant.rollInitiative()` produces in the combat tracker.
    const dexMod = Number(actor.system?.abilities?.dex?.mod ?? 0);
    const extraBonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
    const bonus = dexMod + extraBonus;
    const advantage = Number(actor.system?.roll?.initiative?.advantage ?? 0);
    const baseFormula = "1d20";
    const advFormula = (advantage !== 0 && typeof dice.applyAdvantage === "function")
      ? dice.applyAdvantage(baseFormula, advantage)
      : baseFormula;
    const formula = bonus !== 0 ? `${advFormula} + ${bonus}` : advFormula;

    const config = dice.initializeD20Check({
      actorUuid: actor.uuid,
      mainRoll: { formula },
      type: "initiative",
      heading: `${actor.name} — Initiative <em>(out of combat)</em>`,
      // Tag the config so the createChatMessage hook can identify this roll
      // (and any later reroll via the system's reroll-icon) as an OoC init
      // roll for this specific token, and update CrawlState accordingly.
      [CONFIG_TAG]: tokenId,
      advantage,
    });

    const mainRoll = await dice.rollFromConfig(config);
    if (!mainRoll) return null;
    // CrawlState is updated by the createChatMessage hook above — single
    // source of truth for both initial rolls and rerolls.
    return mainRoll?.roll?.total ?? mainRoll?.total ?? null;
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
    const dexMod = Number(actor.system?.abilities?.dex?.mod ?? 0);
    const extraBonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
    const bonus = dexMod + extraBonus;
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
