/**
 * Shadowdark Enhancer — Encounter Check
 * Slice 1a: d6 roll, chat post, on-hit branch.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { partyHex, tableForCheck } from "./encounter-terrain.mjs";
import { drawEncounter } from "./encounter-draw.mjs";

// v13/v14 namespaced renderTemplate (the global `renderTemplate` still
// works but emits deprecation warnings).
const { renderTemplate } = foundry.applications.handlebars;

/**
 * The zone table the last check resolved when it was a travel check that hit:
 * that table's next draw is the travel draw, where the GM Guide's marked rows
 * give a point of interest (#273). Each check replaces it. It lives on the
 * client that ran the check, so after a reload, or on another GM's client, that
 * table draws as usual.
 */
let travelTableUuid = null;

/**
 * One spelling per table: tableForCheck can name a pack table the short way
 * ("Compendium.<pack>.<id>"), while the roller holds its document's uuid
 * ("Compendium.<pack>.RollTable.<id>").
 */
const canonicalUuid = (uuid) => (uuid ? (foundry.utils.parseUuid(uuid)?.uuid ?? uuid) : null);

export const EncounterCheck = {

  /**
   * Whether this draw of `uuid` is the travel draw. True once, for the table
   * the last check resolved on a travel hit: the auto-roll's draw, or with
   * auto-roll off the GM's next Roll of that table.
   * @param {string} uuid  the table being drawn
   * @returns {boolean}
   */
  takeTravelDraw(uuid) {
    if (!uuid || (canonicalUuid(uuid) !== travelTableUuid)) return false;
    travelTableUuid = null;
    return true;
  },

  /**
   * Perform one encounter check (1d6 vs threshold).
   *
   * Overland's travel checks (#232) pass their own chance, the travel hex
   * (with its region as the zone) and its scene, a label for the card and the
   * recap's clock label. The scene decides the table's north or south half
   * whatever map the GM is viewing. `travel` says the party is travelling
   * (Overland's "move" checks, not a camp's): a hit's zone draw then gives a
   * point of interest on the rows the book marks for it (#273). With no options
   * this is exactly the crawl's check.
   *
   * `quiet` (Overland's checks, #257): nothing in chat, no pause, no roller. A
   * hit draws its encounter at once and returns it, for the clock HUD's panel;
   * the recap still logs the check.
   * @param {{threshold?:number, hex?:object|null, scene?:Scene|null, label?:string, clockLabel?:string,
   *   travel?:boolean, quiet?:boolean}} [options]
   * @returns {Promise<{total: number, hit: boolean, encounter?: object|null}>}
   */
  async check({ threshold: chance, hex: travelHex, scene = null, label = "", clockLabel, travel = false, quiet = false } = {}) {
    const threshold = Number.isInteger(chance) ? chance : game.settings.get(MODULE_ID, "encounterThreshold");
    const roll = await new Roll("1d6").evaluate();
    const hit = roll.total <= threshold;
    // On a hex map the party's hex names itself on the card and picks
    // the table; everywhere else this is null and nothing below changes.
    const hex = travelHex ? { ...travelHex, zone: travelHex.zone ?? travelHex.region ?? undefined } : partyHex();
    // The table for a hit: the region's column for this hex, resolved at the
    // moment of the roll, else the terrain's table, else the active one. A
    // failing lookup falls back to the terrain picker, so the card still posts.
    const table = hit ? await tableForCheck(hex, { scene: scene ?? undefined }) : null;
    // A quiet check draws its own encounter below, so no later draw is the travel draw.
    travelTableUuid = (hit && travel && !quiet) ? canonicalUuid(table?.uuid) : null;

    if (!quiet) await this._postToChat(roll, threshold, hit, hex, table, label);

    const crawlRound = CrawlState.mode === "crawl" ? CrawlState.crawlTurn : null;

    // Record the check in the session recap (self-guards on an active session).
    SessionRecap.logEncounterCheck({
      roll: roll.total, threshold, hit,
      clockLabel: clockLabel ?? (crawlRound === null ? null : game.i18n.format("SDE.encounter.check.clockRound", { round: crawlRound })),
    });

    // Anchor the frequency countdown to the round this check ran on, so the
    // next automatic check is N rounds after THIS one (a manual check counts
    // too). Only in crawl mode: outside it there is no round to anchor.
    if (crawlRound !== null) {
      await game.settings.set(MODULE_ID, "encounterLastCheckRound", crawlRound);
    }

    if (quiet) {
      const doc = hit && table?.uuid ? await fromUuid(table.uuid).catch(() => null) : null;
      // A hit with no table for the hex (a keyed location, no active table) still stops the clock.
      const encounter = !hit ? null : doc ? await drawEncounter(doc, { travel, quiet: true }).catch((err) => {
        console.error(`${MODULE_ID} | drawing the check's encounter failed`, err);
        return { kind: "empty" };
      }) : { kind: "empty", noTable: true };
      return { total: roll.total, hit, encounter };
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
      ? game.i18n.format("SDE.encounter.check.flavorHit", { threshold })
      : game.i18n.format("SDE.encounter.check.flavorMiss", { threshold });
    // "Hex 3723 · forest, river · Lowland Moor: Forest" when the party stands
    // on a numbered hex map, the last part naming the column a hit rolls.
    const column = table?.verdict?.column?.column;
    const where = [label, ...(hex
      ? [Number.isInteger(hex.num) ? game.i18n.format("SDE.encounter.check.hex", { num: hex.num }) : "", [hex.terrain, ...(hex.features ?? [])].filter(Boolean).join(", ").replace(/_/g, " "),
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
