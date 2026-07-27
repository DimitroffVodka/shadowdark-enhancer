/**
 * Shadowdark Enhancer — Spell Mishap Auto-Roll
 *
 * Detects natural 1s on spellcasting checks and automatically rolls
 * the appropriate tiered mishap table from the Shadowdark compendium.
 *
 * Mishap triggers when:
 *   1. A chat message has a spell check (type "spell" in rollConfig)
 *   2. The d20 result is a natural 1
 *   3. The total is below the spell DC (10 + tier)
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** Compendium pack id for the Shadowdark system rollable tables */
const SD_TABLES = "shadowdark.rollable-tables";

/** Mishap table compendium document IDs keyed by tier range */
const MISHAP_TABLES = {
  "1-2": "NiiJKAiBjpPAj5U1",   // Wizard Mishap Tier 1-2
  "3-4": "tXhX6Iv3rOc6GlF6",   // Wizard Mishap Tier 3-4
  "5":   "q83PUKIAznuLpqSr",   // Wizard Mishap Tier 5
};

/** Setting key */
const SETTING = "spellMishapAutoRoll";

/**
 * Map a spell tier (1-5) to a mishap table tier range.
 */
function tierRange(tier) {
  tier = Number(tier) || 1;
  if (tier <= 2) return "1-2";
  if (tier <= 4) return "3-4";
  return "5";
}

/**
 * Get a spell's tier from an item UUID.
 */
async function getSpellTier(itemUuid) {
  if (!itemUuid) return null;
  const item = await fromUuid(itemUuid);
  if (!item || item.type !== "Spell") return null;
  return item.system?.tier ?? null;
}

/**
 * Check if a roll is a natural 1 on a d20.
 */
function isNatural1(roll) {
  if (!roll?.dice?.length) return false;
  return roll.dice.some(die =>
    die.faces === 20 &&
    die.results.some(r => r.active !== false && r.result === 1)
  );
}

/**
 * Detect a spell mishap from a chat message.
 * Returns { tier, actor } if mishap detected, null otherwise.
 */
async function detectMishap(message) {
  const config = message.flags?.shadowdark?.rollConfig;
  if (!config) return null;

  // Must be a spell cast
  if (config.type !== "spell") return null;

  // Must have a natural 1 on the d20
  const mainRoll = message.rolls?.[0];
  if (!mainRoll || !isNatural1(mainRoll)) return null;

  // Get the spell tier
  const tier = await getSpellTier(config.itemUuid);
  if (tier == null) return null;

  // Check if below spell DC (10 + tier): the check must have failed
  const dc = 10 + tier;
  if (mainRoll.total >= dc) return null;

  const actor = config.actorUuid
    ? await fromUuid(config.actorUuid)
    : null;

  // Only Wizards suffer mishaps in Shadowdark — Priests just lose the spell
  const spellcastingClasses = actor?.system?.spellcasting?.classes ?? [];
  if (!spellcastingClasses.includes("wizard")) return null;

  return { tier, actor };
}

/**
 * Roll the mishap table and post the result.
 */
async function rollMishapTable(tier, actor) {
  const range = tierRange(tier);
  const tableId = MISHAP_TABLES[range];
  if (!tableId) return;

  const pack = game.packs.get(SD_TABLES);
  if (!pack) return;

  const tableDoc = await pack.getDocument(tableId);
  if (!tableDoc) return;

  const draw = await tableDoc.draw({ displayChat: true });

  // Post a contextual message
  if (actor) {
    await ChatMessage.create({
      content: game.i18n.format("SDE.mishap.rolled", {
        name: actor.name,
        tier,
        tableName: tableDoc.name,
      }),
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  }

  return draw;
}

export function init() {
  Hooks.on("createChatMessage", async (message) => {
    if (!game.settings.get(MODULE_ID, SETTING)) return;
    if (!game.user.isGM) return; // Only GM rolls mishap tables

    const mishap = await detectMishap(message);
    if (!mishap) return;

    await rollMishapTable(mishap.tier, mishap.actor);
  });
}
