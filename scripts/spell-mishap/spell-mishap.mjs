/**
 * Shadowdark Enhancer — Spell Mishap Auto-Roll
 *
 * Detects natural 1s on spellcasting checks and automatically rolls
 * the class-appropriate mishap table.
 *
 * Mishap triggers when:
 *   1. A chat message has a spell check (type "spell" in rollConfig)
 *   2. The d20 result is a natural 1
 *   3. The total is below the spell DC (10 + tier)
 *   4. The caster is not a divine class (Priest, Green Knight, Seer)
 *
 * Table sets are keyed by spellcasting class:
 *   wizard/necromancer → Wizard Mishap (system pack, tiers 1-2, 3-4, 5)
 *   witch              → Diabolical Mishap (enhancer pack, tiers 1-3, 4-5)
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** Divine spellcasters that do penance or lose the spell — no mishap table */
const DIVINE_CLASSES = new Set(["priest", "green knight", "seer"]);

/**
 * Per-class mishap table configuration.
 * Key = spellcasting class id (matches actor.system.spellcasting.classes)
 */
const MISHAP_SETS = {
  wizard: {
    pack: "shadowdark.rollable-tables",
    tiers: [
      { max: 2, tableId: "NiiJKAiBjpPAj5U1" },  // Wizard Mishap Tier 1-2
      { max: 4, tableId: "tXhX6Iv3rOc6GlF6" },  // Wizard Mishap Tier 3-4
      { max: 5, tableId: "q83PUKIAznuLpqSr" },  // Wizard Mishap Tier 5
    ],
  },
  witch: {
    pack: "world.shadowdark-enhancer--roll-tables",
    tiers: [
      { max: 3, tableId: "tN3Qj8Dj1uvdRBC0" },  // Diabolical Mishap 1-3
      { max: 5, tableId: "fLI3BWuv2FgiEkXb" },  // Diabolical Mishap 4-5
    ],
  },
  // Necromancer uses its own mishap tables (Western Reaches pg. 186-187)
  necromancer: {
    pack: "world.shadowdark-enhancer--roll-tables",
    tiers: [
      { max: 3, tableId: "m3BNCd282yl4Zmaf" },  // Necromancer Mishap 1-3
      { max: 5, tableId: "C3ltjE1DvuU9aO1o" },  // Necromancer Mishap 4-5
    ],
  },
};

/** Setting key */
const SETTING = "spellMishapAutoRoll";

/**
 * Get the mishap table id for a given class and spell tier.
 */
function getMishapTableId(spellcastingClasses, tier) {
  for (const cls of spellcastingClasses) {
    const set = MISHAP_SETS[cls];
    if (!set) continue;
    for (const t of set.tiers) {
      if (tier <= t.max) return { tableId: t.tableId, pack: set.pack };
    }
  }
  return null;
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
 * Returns { tier, actor, spellcastingClasses } if mishap detected, null otherwise.
 */
async function detectMishap(message) {
  const config = message.flags?.shadowdark?.rollConfig;
  if (!config) return null;

  if (config.type !== "spell") return null;

  const mainRoll = message.rolls?.[0];
  if (!mainRoll || !isNatural1(mainRoll)) return null;

  const tier = await getSpellTier(config.itemUuid);
  if (tier == null) return null;

  const dc = 10 + tier;
  if (mainRoll.total >= dc) return null;

  const actor = config.actorUuid
    ? await fromUuid(config.actorUuid)
    : null;

  if (!actor) return null;

  const classes = actor.system?.spellcasting?.classes ?? [];
  if (!classes.length) return null;

  // Divine casters don't get mishap tables
  if (classes.some(c => DIVINE_CLASSES.has(c))) return null;

  return { tier, actor, spellcastingClasses: classes };
}

/**
 * Roll the mishap table and post the result.
 */
async function rollMishapTable(tier, actor, spellcastingClasses) {
  const info = getMishapTableId(spellcastingClasses, tier);
  if (!info) return;

  const pack = game.packs.get(info.pack);
  if (!pack) return;

  const tableDoc = await pack.getDocument(info.tableId);
  if (!tableDoc) return;

  await tableDoc.draw({ displayChat: true });

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
}

export function init() {
  Hooks.on("createChatMessage", async (message) => {
    if (!game.settings.get(MODULE_ID, SETTING)) return;
    if (!game.user.isGM) return;

    const mishap = await detectMishap(message);
    if (!mishap) return;

    await rollMishapTable(mishap.tier, mishap.actor, mishap.spellcastingClasses);
  });
}
