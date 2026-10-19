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

import { MODULE_ID } from "../../shared/module-id.mjs";
import { findMonsterPack } from "./monster-pack.mjs";
import { findSuitePack } from "../../shared/compendium-suite.mjs";
import { enrichContextualText, enrichDice } from "../../shared/contextual-enricher.mjs";

const MONSTER_PACK = "shadowdark.monsters";

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A two-part inverted bestiary name the way the books print it: "Frog, Giant"
 * → "Giant Frog", "Hag, Sea" → "Sea Hag". The system files every variant under
 * its family, while the GM Guide's encounter rows read in natural order ("giant
 * frogs", "gt. frog", "sea hag"), so the index needs both spellings or those
 * rows never link. Three-part names are left alone: "Elemental, Fire (Lesser)"
 * has more than one plausible order and a wrong guess is worse than no link.
 *
 * @param {string} name
 * @returns {string|null} the natural-order name, or null when not inverted
 */
export function naturalOrderName(name) {
  const m = /^([^,()]+),\s*([^,()]+)$/.exec(String(name ?? "").trim());
  return m ? `${m[2].trim()} ${m[1].trim()}` : null;
}

/** The books' abbreviation for Giant ("2d4 gt. frog", GMWR p86; CS2 p39). */
const GIANT_ABBREVIATION = /\bgt\.(?=\s|$)/gi;

/**
 * Spellings the books print that the bestiary files differently. The rows are
 * set from the book's own text — "willowisp", not "Will-o'-Wisp" — so a row can
 * name a creature that exists in the world and still link nothing.
 *
 * This is a NAME, never content: each entry only lets the index find a creature
 * the world already ships. The printed form is lower-case (matches are
 * case-blind) and its plural is built from it as usual ("willowisps").
 */
const PRINTED_ALIASES = {
  "willowisp": "Will-o'-Wisp",
  "faerie": "Fairy",
  // The plural falls on the first word, which the plural rule cannot reach, so
  // both printed forms are listed. Phrase only: "a nervous librarian" (University
  // District) is ordinary folk, not the lvl 6 monster.
  "librarian of leng": "Librarian of Leng",
  "librarians of leng": "Librarian of Leng",
  // Irregular plural (-man -> -men). A general rule is wrong: it would stop
  // "shamans" matching Goblin, Shaman / Stone Shaman.
  "beastmen": "Beastman",
  // Reversed order, plural on the last word: the plural rule appends its "s"
  // there, so the one printed form covers "piranha swarm" and "piranha swarms".
  "piranha swarm": "Piranha, Swarm",
  // The book's spelling; the bestiary's is American.
  "grey ooze": "Gray Ooze",
  // One word in the bestiary; eight other rows already print it that way.
  "mushroom folk": "Mushroomfolk",
  // The row prints the specific half; "cobra statue" still wins as the longer name.
  "cobra": "Snake, Cobra",
  // The hosts of one adventure row ("…platters of cave crabs to Librarians");
  // the phrase alias above still wins where the full name is printed.
  "librarians": "Librarian of Leng",
};

/**
 * Wrap bare dice tokens ("2d20") in an inline roll ("[[/r 2d20]]"). Leaves
 * already-wrapped rolls and lone die sizes ("d6" with no count) alone.
 *
 * Delegates to the A5 contextual enricher, which is the single owner of inline
 * roll syntax and of what counts as already-enriched markup. The local copy
 * this replaces guarded only the exact `[[/r ` prefix, so it double-wrapped the
 * second term of `[[/r 2d4+1d6]]` and rewrote dice inside an existing link
 * label; the shared rule masks those spans instead.
 */
export const convertDice = enrichDice;

/**
 * A bestiary name as a regex source that also matches its plural. Most names
 * take an "s", but the books' rows print the English plural — "giant leeches",
 * "winter wolves", "dwarves", "mummies", "harpies", "pegasi" — so the suffix is
 * chosen from the name's ending rather than assumed to be "s". The label keeps
 * what the row printed, so "mummies" stays "mummies".
 * @param {string} name
 * @returns {string} regex source, without the word boundaries
 */
export function pluralPattern(name) {
  const src = escapeRegex(name);
  if (/[^aeiou]y$/i.test(name)) return `${src.slice(0, -1)}(?:y|ies)`;   // mummy -> mummies
  if (/fe$/i.test(name)) return `${src.slice(0, -2)}(?:fe|ves)`;          // knife -> knives
  if (/ff$/i.test(name)) return `${src}(?:|s)`;                           // mastiff -> mastiffs, not mastives
  if (/f$/i.test(name)) return `${src.slice(0, -1)}(?:f|ves)`;            // wolf -> wolves, dwarf -> dwarves
  if (/us$/i.test(name)) return `${src.slice(0, -2)}(?:us|i)`;            // pegasus -> pegasi
  if (/(?:s|x|z|ch|sh)$/i.test(name)) return `${src}(?:|es)`;             // leech -> leeches
  return `${src}(?:|s)`;
}

/**
 * Embed `@UUID` links for every index name found in the text. Matches whole
 * words, case-insensitively, in the singular or plural form the row prints,
 * longest names first, non-overlapping; links the FIRST occurrence of each
 * name. The link label keeps the text's own casing/plural (so "goblins" stays
 * "goblins").
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
  // A table row prints "Willowman" where the bestiary names "The Willowman". The bare names
  // go after every full one, so the stable sort lets a real monster of that name win. They match
  // as printed (case-sensitive): "The Dark" must not link the word in "a dark cave".
  const bare = index.flatMap((e) => {
    const name = e?.name?.replace(/^the\s+/i, "");
    return name && name !== e.name ? [{ name, uuid: e.uuid, bare: true }] : [];
  });
  const matches = [];
  for (const e of [...index, ...bare].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))) {
    if (!e?.name) continue;
    const re = new RegExp(`\\b(${pluralPattern(e.name)})\\b`, e.bare ? "" : "i");
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
  if (matches.length) return out;
  return embedLoneCreature(out, index);
}

/**
 * A row that is nothing but a creature's name — "Cubi", "Imp", "[[/r 1d6]] cobra",
 * "[[/r 2d4]] seraphs" — where the bestiary files that creature as an inverted
 * variant whose family the row never prints. The specific half is tried only for
 * rows with no other words, and only when exactly one inverted name owns it, so
 * "Cubi" reaches "Devil, Cubi" while a sentence that happens to contain
 * "desert" cannot reach "Dragon, Desert".
 * @param {string} text
 * @param {Array<{name:string, uuid:string}>} index
 * @returns {string} the text, linked when it is a lone creature name
 */
export function embedLoneCreature(text, index) {
  const bare = String(text ?? "").replace(/\[\[[^\]]*\]\]/g, " ").replace(/@UUID\[[^\]]*\]\{[^}]*\}/g, " ").trim();
  const word = /^([A-Za-z][A-Za-z'-]*?)[*†¹²³\d\s)]*$/.exec(bare)?.[1];
  if (!word) return text;
  const owners = new Map();
  for (const e of index) {
    const m = /^([^,()]+),\s*([^,()]+)$/.exec(e?.name ?? "");
    if (!m) continue;
    const key = m[2].trim().toLowerCase();
    owners.set(key, owners.has(key) ? null : e);       // null: two families share it, so it names nothing
  }
  const forms = [word, word.replace(/s$/i, ""), word.replace(/ies$/i, "y"), word.replace(/ves$/i, "f")];
  const hit = forms.map((f) => owners.get(f.toLowerCase())).find(Boolean);
  if (!hit) return text;
  const start = text.lastIndexOf(word);
  return `${text.slice(0, start)}@UUID[${hit.uuid}]{${word}}${text.slice(start + word.length)}`;
}

/**
 * Full Ruins-style enrichment: contextual checks/dice + monster @UUID links.
 *
 * The optional context is used by table/environment and monster callers that
 * need A5's context-sensitive check/request syntax. With no context this
 * preserves the legacy encounter path: dice + monster links only.
 *
 * @param {string} text
 * @param {Array<{name:string, uuid:string}>} index
 * @param {{context?: "table"|"environment"|"monster"|"journal"|"encounter"}} [options]
 */
export function enrichEncounterText(text, index, options) {
  const hasContext = options != null
    && Object.prototype.hasOwnProperty.call(options, "context");
  // "gt." is the books' Giant, expanded before matching so "gt. frog" reaches
  // the index's "Giant Frog" (the natural-order alias below).
  const expanded = String(text ?? "").replace(GIANT_ABBREVIATION, "Giant");
  const enriched = hasContext
    ? enrichContextualText(expanded, { context: options.context })
    : convertDice(expanded);
  return embedLinks(enriched, index);
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
    // The natural-order spelling too, so a row that prints "giant frogs" or
    // "gt. frog" reaches "Frog, Giant" (#262's zone tables are full of them).
    for (const e of [...byName.values()]) {
      const natural = naturalOrderName(e.name);
      const key = natural?.toLowerCase();
      if (key && !byName.has(key)) byName.set(key, { ...e, name: natural, naturalOrder: true });
    }
    // And the spellings the books print (PRINTED_ALIASES), which only resolve
    // against a creature the world already has.
    for (const [printed, name] of Object.entries(PRINTED_ALIASES)) {
      const target = byName.get(name.toLowerCase());
      if (target && !byName.has(printed)) byName.set(printed, { ...target, name: printed, printedAlias: true });
    }
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
      // A stock warband (#201) is a mass-combat unit, not an encounter monster:
      // "2d6 berserkers" must link core Berserker, not the Berserkers warband.
      if (e.type === `${MODULE_ID}.warband`) continue;
      const key = e.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: e.name, uuid: e.uuid, type: e.type });
    }
  },

  invalidate() { this._index = null; },
};
