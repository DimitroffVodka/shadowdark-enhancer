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

  /** Build (and cache) the monster name->uuid index from shadowdark.monsters,
   *  deduped by lowercased name, sorted longest-name-first. */
  async buildIndex() {
    if (this._index) return this._index;
    const pack = game.packs.get(MONSTER_PACK);
    if (!pack) return (this._index = []);
    const idx = await pack.getIndex();
    const byName = new Map();
    for (const e of idx.contents) {
      const key = e.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: e.name, uuid: e.uuid });
    }
    this._index = [...byName.values()].sort((a, b) => b.name.length - a.name.length);
    return this._index;
  },

  invalidate() { this._index = null; },
};
