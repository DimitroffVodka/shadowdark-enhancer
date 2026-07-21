/**
 * Shadowdark Enhancer — Encounter Check
 * Slice 1a: d6 roll, chat post, on-hit branch.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";

// v13/v14 namespaced renderTemplate (the global `renderTemplate` still
// works but emits deprecation warnings).
const { renderTemplate } = foundry.applications.handlebars;

export const EncounterCheck = {

  /**
   * Perform one encounter check (1d6 vs threshold).
   * @returns {Promise<{total: number, hit: boolean}>}
   */
  async check() {
    const threshold = game.settings.get(MODULE_ID, "encounterThreshold");
    const roll = await new Roll("1d6").evaluate();
    const hit = roll.total <= threshold;

    await this._postToChat(roll, threshold, hit);

    // Record the check in the session recap (self-guards on an active session).
    const clockLabel = CrawlState.mode === "crawl" ? `Turn ${CrawlState.crawlTurn}` : null;
    SessionRecap.logEncounterCheck({ roll: roll.total, threshold, hit, clockLabel });

    if (hit) {
      if (game.settings.get(MODULE_ID, "pauseOnEncounter")) {
        game.togglePause(true, true);
      }

      // Open roller on tables tab
      const roller = await game.shadowdarkEnhancer.encounter.openRoller("tables");

      // Auto-roll if configured and table set
      const autoRoll = game.settings.get(MODULE_ID, "autoRollActiveTable");
      const tableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");
      if (autoRoll && tableUuid) {
        // Short delay to let window render
        setTimeout(() => roller.rollActiveTable(), 200);
      }
    }

    return { total: roll.total, hit };
  },

  /**
   * Post the check result to chat. Uses `Roll#toMessage` so the d6
   * is attached as an actual Roll on the message — Dice So Nice fires
   * the 3D dice, the roll is persisted on the ChatMessage, and players
   * can inspect it. The `content` field overrides toMessage's default
   * formula rendering with our hit/miss-styled card.
   *
   * @private
   */
  async _postToChat(roll, threshold, hit) {
    const gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly");
    const flavor = hit
      ? `🎲 Encounter Check — encounter occurs (threshold ${threshold}-in-6)`
      : `🎲 Encounter Check — the dungeon is quiet (threshold ${threshold}-in-6)`;

    const content = await renderTemplate(
      "modules/shadowdark-enhancer/templates/chat/encounter-check.hbs",
      { roll, hit, threshold, flavor },
    );

    await roll.toMessage(
      {
        flavor,
        content,
        whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : [],
      },
      { rollMode: gmOnly ? CONST.DICE_ROLL_MODES.PRIVATE : CONST.DICE_ROLL_MODES.PUBLIC },
    );
  },
};
