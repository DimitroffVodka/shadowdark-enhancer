/**
 * Shadowdark Enhancer — Encounter Check
 * Slice 1a: d6 roll, chat post, on-hit branch.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { partyHex, tableForCheck } from "./encounter-terrain.mjs";

// v13/v14 namespaced renderTemplate (the global `renderTemplate` still
// works but emits deprecation warnings).
const { renderTemplate } = foundry.applications.handlebars;

export const EncounterCheck = {

  /**
   * Perform one encounter check (1d6 vs threshold).
   *
   * Overland's travel checks (#232) pass their own chance, the travel hex
   * (with its region as the zone), a label for the card and the recap's clock
   * label. With no options this is exactly the crawl's check.
   * @param {{threshold?:number, hex?:object|null, label?:string, clockLabel?:string}} [options]
   * @returns {Promise<{total: number, hit: boolean}>}
   */
  async check({ threshold: chance, hex: travelHex, label = "", clockLabel } = {}) {
    const threshold = Number.isInteger(chance) ? chance : game.settings.get(MODULE_ID, "encounterThreshold");
    const roll = await new Roll("1d6").evaluate();
    const hit = roll.total <= threshold;
    // On a tagged hex map the party's hex names itself on the card and picks
    // the table; everywhere else this is null and nothing below changes.
    const hex = travelHex ? { ...travelHex, zone: travelHex.zone ?? travelHex.region ?? undefined } : partyHex();
    // The table for a hit: the region's column for this hex, resolved at the
    // moment of the roll, else the terrain's table, else the active one. A
    // failing lookup falls back to the terrain picker, so the card still posts.
    const table = hit ? await tableForCheck(hex) : null;

    await this._postToChat(roll, threshold, hit, hex, table, label);

    const crawlRound = CrawlState.mode === "crawl" ? CrawlState.crawlTurn : null;

    // Record the check in the session recap (self-guards on an active session).
    SessionRecap.logEncounterCheck({
      roll: roll.total, threshold, hit,
      clockLabel: clockLabel ?? (crawlRound === null ? null : `Round ${crawlRound}`),
    });

    // Anchor the frequency countdown to the round this check ran on, so the
    // next automatic check is N rounds after THIS one (a manual check counts
    // too). Only in crawl mode: outside it there is no round to anchor.
    if (crawlRound !== null) {
      await game.settings.set(MODULE_ID, "encounterLastCheckRound", crawlRound);
    }

    if (hit) {
      if (game.settings.get(MODULE_ID, "pauseOnEncounter")) {
        game.togglePause(true, true);
      }

      // Open roller on tables tab
      const roller = await game.shadowdarkEnhancer.encounter.openRoller("tables");

      // Auto-roll if configured and a table was found for the party's hex.
      const autoRoll = game.settings.get(MODULE_ID, "autoRollActiveTable");
      const tableUuid = table?.uuid;
      if (autoRoll && tableUuid) {
        // Short delay to let window render
        setTimeout(() => roller.rollActiveTable(tableUuid), 200);
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
  async _postToChat(roll, threshold, hit, hex = null, table = null, label = "") {
    const gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly");
    const flavor = hit
      ? `🎲 Encounter Check — encounter occurs (threshold ${threshold}-in-6)`
      : `🎲 Encounter Check — the dungeon is quiet (threshold ${threshold}-in-6)`;
    // "Hex 3723 · forest, river · Lowland Moor: Forest" when the party stands
    // on a tagged hex map, the last part naming the column a hit rolls.
    const column = table?.verdict?.column?.column;
    const where = [label, ...(hex
      ? [`Hex ${hex.num}`, [hex.terrain, ...(hex.features ?? [])].filter(Boolean).join(", ").replace(/_/g, " "),
        column ? `${table.zone}: ${column}` : ""]
      : [])].filter(Boolean).join(" · ");

    const content = await renderTemplate(
      "modules/shadowdark-enhancer/templates/chat/encounter-check.hbs",
      { roll, hit, threshold, flavor, where },
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
