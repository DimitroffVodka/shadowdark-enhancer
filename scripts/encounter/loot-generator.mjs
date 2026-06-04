/**
 * Shadowdark Enhancer — Loot generator (G2).
 *
 * Draws from a GM-mapped RollTable and produces a structured loot batch:
 * DOCUMENT results resolve to compendium items; TEXT results become coins
 * (if parseable) or flavor notes. No item creation at roll time.
 *
 * Batch shape:
 *   { tier, level, coins:{gp,sp,cp}, items:[{uuid,name,qty,img}], notes:[] }
 */

import { TREASURE_TABLES } from "./treasure-data.mjs";
import { isCoinEntry, parseValue } from "./loot-pack.mjs";
import { MODULE_ID } from "../module-id.mjs";
import { itemValueGp, parseValueGp, bonusOf, isMagicItem, scoreItem } from "./loot-value.mjs";

/** Build the document uuid for a drawn TableResult (Item rows). */
export function resultUuid(r) {
  if (r.documentUuid) return r.documentUuid;
  const coll = r.documentCollection, id = r.documentId;
  if (!coll || !id) return null;
  return coll.includes(".") ? `Compendium.${coll}.Item.${id}` : `${coll}.${id}`;
}

/** Classify one drawn TableResult into coin / item / note (pure). */
export function classifyResult(r) {
  const isDoc = r.type === 1 || r.type === "document" || !!r.documentCollection;
  if (isDoc) {
    const uuid = resultUuid(r);
    if (uuid) return { kind: "item", uuid, name: r.text };
  }
  const text = (r.text ?? "").trim();
  if (isCoinEntry(text)) return { kind: "coin", coins: parseValue(text) };
  return { kind: "note", text };
}

export const LootGenerator = {

  tierForLevel(level) {
    const lv = Number(level) || 0;
    return TREASURE_TABLES.find(t => lv >= t.min && lv <= t.max)
      ?? TREASURE_TABLES[TREASURE_TABLES.length - 1];
  },

  /**
   * Resolve a character level to the GM-mapped RollTable uuid for its
   * treasure band, or null when no table is mapped for that band.
   */
  tableForLevel(level) {
    const tier = this.tierForLevel(level);
    const map = game.settings.get(MODULE_ID, "lootTierTables") ?? {};
    return map[tier.id] || null;
  },

  /** The Unique Feature table: the configured uuid, else a name match, else null. */
  _uniqueFeatureTable() {
    const uuid = game.settings.get(MODULE_ID, "uniqueFeatureTableUuid");
    if (uuid) { const t = fromUuidSync(uuid); if (t?.documentName === "RollTable") return t; }
    return game.tables.find(t => /unique feature/i.test(t.name)) ?? null;
  },

  /** Draw one cosmetic Unique Feature string from a table (or null). */
  async _rollFeature(table) {
    if (!table) return null;
    const draw = await table.draw({ displayChat: false }).catch(() => null);
    const text = draw?.results?.[0]?.text?.trim();
    return text || null;
  },

  /**
   * Generate a loot batch by drawing a RollTable `rolls` times.
   * @param {number} level
   * @param {object} [opts]
   * @param {number} [opts.rolls=1]
   * @param {string|null} [opts.tableUuid] explicit table; else the tier map
   * @returns {Promise<{tier,level,coins,items,notes,error?}>}
   */
  async generate(level, { rolls = 1, tableUuid = null } = {}) {
    const tier = this.tierForLevel(level);
    const base = { tier: tier.id, level: Number(level) || 0, coins: { gp: 0, sp: 0, cp: 0 }, items: [], notes: [] };

    const uuid = tableUuid ?? this.tableForLevel(level);
    const table = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (!table || table.documentName !== "RollTable") return { ...base, error: "no-table" };

    const { coins, items, notes } = base;
    const thresholds = {
      normal: Number(game.settings.get(MODULE_ID, "xpThresholdNormal")) || 10,
      fabulous: Number(game.settings.get(MODULE_ID, "xpThresholdFabulous")) || 150,
    };
    const featureTable = this._uniqueFeatureTable();
    const featureChance = Number(game.settings.get(MODULE_ID, "uniqueFeatureChance"));
    const featurePct = Number.isFinite(featureChance) ? featureChance : 100;
    for (let i = 0; i < Math.max(1, rolls); i++) {
      // Re-draw past blank rows. PDF-imported tables often carry empty
      // TEXT rows (no text, no document); a draw landing on one would
      // otherwise yield a "(nothing)" result. Bounded so a mostly-empty
      // table can't loop forever.
      for (let attempt = 0; attempt < 12; attempt++) {
        const draw = await table.draw({ displayChat: false });
        let gotContent = false;
        for (const r of draw.results) {
          const res = classifyResult(r);
          if (res.kind === "coin") {
            const sum = (res.coins.gp || 0) + (res.coins.sp || 0) + (res.coins.cp || 0);
            if (sum > 0) {
              coins.gp += res.coins.gp; coins.sp += res.coins.sp; coins.cp += res.coins.cp;
              gotContent = true;
            }
          } else if (res.kind === "item") {
            const doc = await fromUuid(res.uuid).catch(() => null);
            const gp = itemValueGp(doc) || parseValueGp(res.name);
            const magic = isMagicItem({
              name: res.name,
              type: doc?.type,
              needsRefinement: doc?.getFlag?.(MODULE_ID, "needsRefinement"),
              magicPack: typeof res.uuid === "string" && /spell|magic/i.test(res.uuid),
            });
            const { tier, xp } = scoreItem({ gp, magic, bonus: bonusOf(res.name) }, thresholds);
            const forgeable = magic && (doc?.getFlag?.(MODULE_ID, "needsRefinement") === true);
            let feature = null;
            const valuable = typeof res.uuid === "string" && res.uuid.includes("world.loot") && !magic;
            if (valuable && featureTable && featurePct > 0) {
              const fRoll = (await new Roll("1d100").evaluate()).total;
              if (fRoll <= featurePct) feature = await this._rollFeature(featureTable);
            }
            items.push({ uuid: res.uuid, name: doc?.name ?? res.name, qty: 1, img: doc?.img ?? "icons/svg/item-bag.svg", value: gp, tier, xp, feature, forgeable });
            gotContent = true;
          } else if (res.text) {
            notes.push(res.text);
            gotContent = true;
          }
        }
        if (gotContent) break;
      }
    }
    const coinGp = Math.round((coins.gp || 0) + (coins.sp || 0) / 10 + (coins.cp || 0) / 100);
    const coinXp = coinGp > 0 ? scoreItem({ gp: coinGp, magic: false }, thresholds).xp : 0;
    base.totalGp = coinGp + items.reduce((s, i) => s + (i.value || 0), 0);
    base.totalXp = coinXp + items.reduce((s, i) => s + (i.xp || 0), 0);
    return base;
  },
};
