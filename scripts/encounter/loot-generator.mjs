/**
 * Shadowdark Enhancer — Loot generator (G2).
 *
 * Rolls a treasure tier and produces a structured loot batch: items resolved
 * to compendium uuids (existing gear/magic OR the world "Loot" catalog) plus
 * aggregated coins. Reuses the bundled treasure tables, the importer parser,
 * the loot-linker, and the loot-pack coin/price helpers. No item creation at
 * roll time — the catalog already holds every treasure entry.
 *
 * Batch shape:
 *   { tier, level, coins:{gp,sp,cp}, items:[{uuid,name,qty,img}], notes:[] }
 */

import { TREASURE_TABLES } from "./treasure-data.mjs";
import { parseTables } from "./table-importer.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { isCoinEntry, parseValue, stripPrice } from "./loot-pack.mjs";
import { MODULE_ID } from "../module-id.mjs";

const LOOT_PACK = "world.loot";

export const LootGenerator = {

  /** The treasure tier band ({id,min,max,text}) covering a character level. */
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
   * Pick a row from a parsed d100 table by a real 1d100 roll. The book's
   * "00" row (parsed as min=max=0) covers a roll of 100.
   */
  async _rollRow(rows) {
    const r = (await new Roll("1d100").evaluate()).total;
    return rows.find(x => (x.min === 0 && x.max === 0) ? r === 100 : (r >= x.min && r <= x.max))
      ?? rows[rows.length - 1];
  },

  /** Resolve one rolled result text → coin / item / unresolved-text. */
  async _resolveRow(text, items) {
    if (isCoinEntry(text)) return { kind: "coin", coins: parseValue(text) };

    // Match existing gear/magic OR a world.loot catalog item (its name is the
    // full description, so findLink resolves it directly).
    const link = LootLinker.findLink(text, items);
    let uuid = link?.uuid;
    let name = link?.name;

    // Name-exact fallback into the Loot catalog (covers +N / odd names that
    // the substring matcher misses).
    if (!uuid) {
      const pack = game.packs.get(LOOT_PACK);
      if (pack) {
        const idx = await pack.getIndex();
        const want = stripPrice(text).toLowerCase();
        const e = [...idx].find(x => (x.name ?? "").toLowerCase() === want);
        if (e) { uuid = e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`; name = e.name; }
      }
    }

    if (!uuid) return { kind: "text", text };
    const doc = await fromUuid(uuid).catch(() => null);
    return { kind: "item", uuid, name: name ?? doc?.name ?? text, img: doc?.img };
  },

  /**
   * Generate a loot batch for a treasure level.
   * @param {number} level
   * @param {object} [opts]
   * @param {number} [opts.rolls=1]
   * @returns {Promise<{tier,level,coins,items,notes}>}
   */
  async generate(level, { rolls = 1 } = {}) {
    const tier = this.tierForLevel(level);
    const items = await LootLinker.buildItemIndex();
    const [pt] = parseTables(tier.text);

    const coins = { gp: 0, sp: 0, cp: 0 };
    const out = [];
    const notes = [];

    for (let i = 0; i < Math.max(1, rolls); i++) {
      const row = await this._rollRow(pt.rows);
      const res = await this._resolveRow(row.text, items);
      if (res.kind === "coin") {
        coins.gp += res.coins.gp; coins.sp += res.coins.sp; coins.cp += res.coins.cp;
      } else if (res.kind === "item") {
        out.push({ uuid: res.uuid, name: res.name, qty: 1, img: res.img ?? "icons/svg/item-bag.svg" });
      } else {
        notes.push(res.text);
      }
    }

    return { tier: tier.id, level: Number(level) || 0, coins, items: out, notes };
  },
};
