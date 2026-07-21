/**
 * Shadowdark Enhancer — Monster linker.
 *
 * Enriches a RollTable's encounter text the way the system's own "Ruin
 * Encounters" table is built: monster names become clickable/draggable
 * `@UUID[Compendium.shadowdark.monsters.…]{name}` links, and bare dice counts
 * ("2d4 goblins") become inline rolls ("[[/r 2d4]] @UUID{goblins}").
 *
 * Copyright-safe: operates on the GM's OWN imported tables and links to the
 * monster compendium already in their world — ships no content, only machinery.
 *
 * The pure pieces (`escapeRegex`, `convertDice`, `embedLinks`,
 * `enrichEncounterText`) are Foundry-free and unit-tested.
 */

import { findMonsterPack } from "./monster-pack.mjs";
import { findSuitePack } from "../../shared/compendium-suite.mjs";

const MONSTER_PACK = "shadowdark.monsters";

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap bare dice tokens ("2d20") in an inline roll ("[[/r 2d20]]"). Leaves
 *  already-wrapped rolls and lone die sizes ("d6" with no count) alone. */
export function convertDice(text) {
  return String(text ?? "").replace(/(?<!\[\[\/r\s)\b(\d+d\d+(?:[*x]\d+)?)\b/gi, "[[/r $1]]");
}

/**
 * Embed `@UUID` links for every index name found in the text. Matches whole
 * words, case-insensitively, optional trailing plural "s", longest names first,
 * non-overlapping; links the FIRST occurrence of each name. The link label
 * keeps the text's own casing/plural (so "goblins" stays "goblins").
 *
 * @param {string} text
 * @param {Array<{name:string, uuid:string}>} index  longest-name-first
 */
export function embedLinks(text, index) {
  const src = String(text ?? "");
  const taken = new Array(src.length).fill(false);
  // Protect already-linked spans (@UUID[...]{...}) and inline rolls ([[...]])
  // so enrichment is idempotent — re-running never double-links.
  for (const re of [/@UUID\[[^\]]*\]\{[^}]*\}/g, /\[\[[^\]]*\]\]/g]) {
    let mm;
    while ((mm = re.exec(src))) for (let i = mm.index; i < mm.index + mm[0].length; i++) taken[i] = true;
  }
  const matches = [];
  for (const e of index) {
    if (!e?.name) continue;
    const re = new RegExp(`\\b(${escapeRegex(e.name)})(s?)\\b`, "i");
    const m = re.exec(src);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    let clash = false;
    for (let i = start; i < end; i++) if (taken[i]) { clash = true; break; }
    if (clash) continue;
    for (let i = start; i < end; i++) taken[i] = true;
    matches.push({ start, end, label: m[0], uuid: e.uuid });
  }
  matches.sort((a, b) => b.start - a.start); // apply right-to-left
  let out = src;
  for (const mt of matches) {
    out = out.slice(0, mt.start) + `@UUID[${mt.uuid}]{${mt.label}}` + out.slice(mt.end);
  }
  return out;
}

/** Full Ruins-style enrichment: inline dice rolls + monster @UUID links. */
export function enrichEncounterText(text, index) {
  return embedLinks(convertDice(text), index);
}

export const MonsterLinker = {
  _index: null,

  /**
   * Build (and cache) the monster name->uuid index, deduped by lowercased name,
   * sorted longest-name-first.
   *
   * Sources, IN PRIORITY ORDER:
   *   1. `shadowdark.monsters` (Core) — indexed FIRST, so a Core monster always
   *      wins a name clash.
   *   2. The managed world imported-monsters pack (flag `monsterPack`, created by
   *      the Monster Importer) — added only for names Core doesn't already have,
   *      so imported CS/WR monsters FILL GAPS and never shadow a Core monster.
   *
   * The importer calls `invalidate()` after each batch, so freshly imported
   * monsters become linkable without a reload.
   */
  async buildIndex() {
    if (this._index) return this._index;
    const byName = new Map();
    await this._indexPack(game.packs.get(MONSTER_PACK), byName);             // Core first
    await this._indexPack(this._importedMonsterPack(), byName);             // imports fill gaps
    this._index = [...byName.values()].sort((a, b) => b.name.length - a.name.length);
    return this._index;
  },

  /**
   * The managed world Actor compendium for indexing.
   * Returns sde-actors (suite pack) first — canonical post-migration (D-03).
   * Falls back to the legacy imported-monsters pack via findMonsterPack() so the
   * linker keeps working for worlds that haven't migrated yet (D-06).
   */
  _importedMonsterPack() {
    return findSuitePack("sde-actors") ?? findMonsterPack();
  },

  /** Add a pack's name->uuid entries to `byName`, first-writer-wins (priority). */
  async _indexPack(pack, byName) {
    if (!pack) return;
    const idx = await pack.getIndex();
    for (const e of idx.contents) {
      if (!e?.name) continue;
      const key = e.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: e.name, uuid: e.uuid });
    }
  },

  invalidate() { this._index = null; },
};
