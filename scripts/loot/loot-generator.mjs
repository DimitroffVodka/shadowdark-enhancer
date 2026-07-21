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
import { isCoinEntry, parseValue, isDeferredType, stripPrice, fabricateTreasureItem, pickTreasureIcon } from "./loot-pack.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { itemValueGp, parseValueGp, bonusOf, isMagicItem, scoreItem, forgeTypeOf } from "./loot-value.mjs";

/**
 * The uuid of the LINKED item for a drawn TableResult, or null for a text row.
 * Read from `_source` only: the `documentUuid`/`documentCollection` getters
 * throw on broken links + emit v13 deprecations, and `r.uuid` is the RESULT's
 * OWN id (a TableResult), never the linked item — using it makes every text row
 * resolve to itself.
 */
export function resultUuid(r) {
  // v13 migrates documentCollection/documentId into documentUuid; the legacy
  // accessors are deprecation getters that THROW on text rows (even on
  // `_source`), so read `documentUuid` and nothing else.
  return r?._source?.documentUuid || null;
}

/**
 * The displayed string for a drawn TableResult. Foundry v13 split
 * `TableResult#text` into `name` + `description`; the importer stores TEXT-row
 * content in `name`. Read from `_source` so a broken document link can't throw.
 */
export function resultText(r) {
  const s = r?._source ?? {};
  return (s.name || s.text || s.description || "").trim();
}

/** Classify one drawn TableResult into coin / item / note (pure). */
export function classifyResult(r) {
  // A linked-document result has a documentUuid; everything else is a text row.
  const uuid = resultUuid(r);
  if (uuid) return { kind: "item", uuid, name: resultText(r) };
  const text = resultText(r);
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

  /**
   * The tier id a directly-selected loot table maps to: its `lootTierTables`
   * binding first, else inferred from the table name, else null. Lets the
   * Loot Generator window roll/label a hand-picked table at its real tier
   * instead of always level 0.
   */
  tierForTable(uuid) {
    const map = game.settings.get(MODULE_ID, "lootTierTables") ?? {};
    const bound = Object.entries(map).find(([, u]) => u === uuid)?.[0];
    if (bound) return bound;
    const name = fromUuidSync(uuid)?.name ?? "";
    return TREASURE_TABLES.find(t => name.includes(t.id))?.id ?? null;
  },

  /** A representative character level for a tier id (the band's min) for scoring/labeling. */
  levelForTier(tierId) {
    return TREASURE_TABLES.find(t => t.id === tierId)?.min ?? 0;
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
    const text = resultText(draw?.results?.[0]);
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
    // Index of real items, so TEXT rows that name existing gear/valuables link to them.
    const itemIndex = await LootLinker.buildItemIndex();
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
            items.push({ uuid: res.uuid, name: doc?.name ?? res.name, qty: 1, img: doc?.img ?? "icons/svg/item-bag.svg", value: gp, tier, xp, feature, forgeable, forgeType: forgeTypeOf({ type: doc?.type, name: doc?.name ?? res.name }) });
            gotContent = true;
          } else {
            // TEXT row → link to a real item, fabricate a priced valuable, else keep as flavor.
            const text = res.text;
            if (!text) continue;
            const link = LootLinker.findLink(text, itemIndex);
            if (link) {
              const doc = await fromUuid(link.uuid).catch(() => null);
              const gp = itemValueGp(doc) || parseValueGp(text);
              const magic = isMagicItem({ name: link.name, type: doc?.type, needsRefinement: doc?.getFlag?.(MODULE_ID, "needsRefinement"), magicPack: /spell|magic/i.test(link.uuid) });
              const { tier, xp } = scoreItem({ gp, magic, bonus: bonusOf(text) }, thresholds);
              items.push({ uuid: link.uuid, name: doc?.name ?? link.name, qty: 1, img: doc?.img ?? pickTreasureIcon(text), value: gp, tier, xp, feature: null, forgeable: magic && doc?.getFlag?.(MODULE_ID, "needsRefinement") === true, forgeType: forgeTypeOf({ type: doc?.type, name: doc?.name ?? link.name }) });
              gotContent = true;
              continue;
            }
            const value = parseValue(text);
            const gp = (value.gp || 0) + (value.sp || 0) / 10 + (value.cp || 0) / 100;
            const deferred = isDeferredType(text);
            if (gp > 0 || deferred) {
              // Fabricate a real Basic treasure Item from the row text + price.
              const name = stripPrice(text);
              const itemData = fabricateTreasureItem({ name, value, needsRefinement: deferred });
              const { tier, xp } = scoreItem({ gp, magic: deferred, bonus: bonusOf(text) }, thresholds);
              let feature = null;
              if (!deferred && featureTable && featurePct > 0) {
                const fRoll = (await new Roll("1d100").evaluate()).total;
                if (fRoll <= featurePct) feature = await this._rollFeature(featureTable);
              }
              items.push({ uuid: null, fabricate: itemData, name, qty: 1, img: itemData.img, value: gp, tier, xp, feature, forgeable: deferred, forgeType: forgeTypeOf({ type: itemData?.type, name }) });
              gotContent = true;
              continue;
            }
            notes.push(text);
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
