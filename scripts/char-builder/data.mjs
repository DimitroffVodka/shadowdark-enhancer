/**
 * Data helpers for the character builder. Thin wrappers over the Shadowdark
 * system's own compendium loaders + Foundry roll/enrich utilities, so the
 * builder always reflects the live installed content.
 */


/** Enrich Shadowdark description HTML — resolves @UUID links + [[/r]] inline rolls. */
export async function enrich(html) {
  if (!html) return "";
  try {
    return await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(html), { secrets: false });
  } catch (_e) {
    return String(html);
  }
}

/** Load ancestries from the system compendium, sorted by name. */
export async function loadAncestries() {
  const list = Array.from(await shadowdark.compendiums.ancestries());
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Talent descriptions the installed content ships wrong, corrected here so the
 * builder AND the committed actor read right without mutating shared
 * system-compendium data (survives system updates; version-controlled).
 *
 * Shadowdark 4.0.6 models the Elf "Farsight" talent as two pick-one variants
 * (Ranged / Spell) but gives BOTH the full "…ranged weapons or …spellcasting
 * checks" text — so the choose-one shows two identical options. Each variant
 * should describe only the half it grants. Text-only: the ActiveEffects are
 * already correct and distinct (ranged-attack vs spellcasting bonus).
 * Keyed by talent UUID.
 */
export const TALENT_DESCRIPTION_FIXES = {
  "Compendium.shadowdark.talents.Item.dTEZW21LUNoYL3JU":
    "<p>You get a +1 bonus to attack rolls with ranged weapons.</p>",
  "Compendium.shadowdark.talents.Item.E3EcGGdGYuEWWj47":
    "<p>You get a +1 bonus to spellcasting checks.</p>",
};

/** A talent doc's description HTML, with any known-bad text corrected. */
export function talentDescription(doc) {
  return (doc?.uuid && TALENT_DESCRIPTION_FIXES[doc.uuid]) || doc?.system?.description || "";
}

/**
 * Pick a random element. If `weightPath` is given, weight each item by the
 * integer at that property path (default weight 1).
 */
export function weightedRandom(items, weightPath) {
  if (!items?.length) return null;
  if (!weightPath) return items[Math.floor(Math.random() * items.length)];
  const weights = items.map((i) => Math.max(1, Number(foundry.utils.getProperty(i, weightPath)) || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Stripped text for a TableResult. Different tables store the value in
 * different fields — the enhancer name tables use `description`, while the
 * Nord table leaves `description` an empty string and puts the name in `name`.
 * So pick the first NON-EMPTY of description/name (a plain `??` chain would
 * stop at the empty-string `description` and miss `name`). `TableResult#text`
 * is deliberately not read — deprecated in v13, removed in v15.
 */
export function resultText(r) {
  for (const field of [r?.description, r?.name]) {
    const v = String(field ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (v) return v;
  }
  return "";
}

/** Build choose-dropdown options ({ value, label }) from a RollTable's results. */
export function tableOptions(table) {
  if (!table?.results) return [];
  return table.results.contents
    .map((r) => { const v = resultText(r); return { value: v, label: v }; })
    .filter((o) => o.value);
}

/** Roll a resolved RollTable document (no chat), returning stripped result text. */
export async function rollTableDoc(table) {
  if (!table?.roll) return null;
  try {
    const res = await table.roll();
    const r = res?.results?.[0] ?? res?.results?.contents?.[0];
    if (!r) return null;
    return resultText(r) || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Find a RollTable by (case-insensitive) name across the world directory and
 * every RollTable compendium. When `hints` is given, prefer a match whose
 * pack collection id contains one of the hint keywords — this disambiguates
 * identically-named tables that live in different source packs (e.g. the
 * "<Ancestry> Trinket" tables shipped by both the enhancer and Western Reaches).
 * With `requireHints`, a non-hint match is not an acceptable fallback: return
 * null instead, so a source whose pack isn't installed drops out rather than
 * silently serving another source's table.
 */
export async function findTableByName(names, hints = [], { requireHints = false } = {}) {
  const wants = names.map((n) => String(n).toLowerCase().trim());
  const matches = [];
  for (const t of (game.tables ?? [])) {
    if (wants.includes(t.name.toLowerCase().trim())) matches.push({ doc: t, key: "world" });
  }
  for (const p of game.packs.filter((pk) => pk.documentName === "RollTable")) {
     
    const idx = await p.getIndex();
    for (const e of idx) {
      if (wants.includes(e.name.toLowerCase().trim())) matches.push({ pack: p, id: e._id, key: p.collection.toLowerCase() });
    }
  }
  let pick = matches;
  if (hints.length) {
    const pref = matches.filter((m) => hints.some((h) => m.key.includes(h)));
    if (pref.length) pick = pref;
    else if (requireHints) return null;
  }
  if (!pick.length) return null;
  const m = pick[0];
  return m.doc ?? await m.pack.getDocument(m.id);
}

/**
 * The name table an ancestry points at via `system.nameTable` (how the system
 * generator resolves names — also the only hook homebrew ancestries have),
 * falling back to the naming conventions of the enhancer / system packs.
 */
export async function coreNameTable(item) {
  const uuid = item?.system?.nameTable;
  if (uuid) {
    const t = await fromUuid(uuid).catch(() => null);
    if (t?.results?.size > 0) return t;
  }
  const a = item?.name ?? "";
  return findTableByName([`${a} Names`, `Character Names: ${a}`], ["shadowdark-enhancer", "shadowdark.rollable"]);
}

// --- Auto-discovered Name / Trinket / Background / Deity tables --------------
// No setting: the builder finds every installed table that fits the kind, so
// imported content "just works". Name/Trinket tables must also name a known
// installed ancestry (keeps Dungeon / Adventure Site / Magic Item name tables
// out); the Ancestry step then narrows per-ancestry via tableMatchesAncestry.

const _configuredDocCache = new Map();   // uuid → RollTable doc (session-lived)
const _reEsc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/** Drop the session doc cache so freshly-unlocked/replaced tables are re-read
 *  on the next configuredTables() call (see char-builder live refresh). */
export function invalidateConfiguredTables() { _configuredDocCache.clear(); }

/** A name-predicate for the kind, or null for an unknown kind. */
async function _kindMatcher(kind) {
  if (kind === "background") return (n) => /\bbackgrounds?\b/i.test(n);
  if (kind === "deity") return (n) => /\bdeit(y|ies)\b/i.test(n);
  if (kind === "name" || kind === "trinket") {
    const ancestries = (await loadAncestries()).map((a) => a.name.toLowerCase()).filter(Boolean);
    const ancRe = ancestries.length ? new RegExp(`\\b(${ancestries.map(_reEsc).join("|")})\\b`, "i") : /$^/;
    const kindRe = kind === "name" ? /\bnames?\b/i : /\btrinkets?\b/i;
    return (n) => kindRe.test(n) && ancRe.test(n);
  }
  return null;
}

/**
 * Every installed RollTable that fits `kind` ("name" | "trinket" | "background"
 * | "deity"), resolved to non-empty docs. Auto-discovered from the world
 * directory + all RollTable packs — no GM setting — so imported tables are
 * available by default.
 */
export async function configuredTables(kind) {
  const match = await _kindMatcher(kind);
  if (!match) return [];
  const candidates = [];
  for (const t of (game.tables ?? [])) if (match(t.name)) candidates.push({ uuid: t.uuid, doc: t });
  for (const p of game.packs.filter((pk) => pk.documentName === "RollTable")) {
     
    for (const e of await p.getIndex()) if (match(e.name)) candidates.push({ uuid: `Compendium.${p.collection}.RollTable.${e._id}` });
  }
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.uuid)) continue;
    seen.add(c.uuid);
    let doc = c.doc ?? _configuredDocCache.get(c.uuid);
     
    if (doc === undefined) { doc = await fromUuid(c.uuid).catch(() => null); _configuredDocCache.set(c.uuid, doc); }
    if (doc?.results?.size > 0) {
      const origin = doc.pack ? (game.packs.get(doc.pack)?.title ?? doc.pack) : "world";
      out.push({ uuid: c.uuid, name: doc.name, origin, doc });
    }
  }
  return out;
}

/**
 * Roll one of the GM-configured tables for `kind` and map the result back to
 * one of `items` (compendium docs) — via the linked document when the table
 * rows link Items, else by (loose) name match on the result text. Returns the
 * matched item, or null when nothing is configured / the roll doesn't map —
 * callers fall back to their plain random pick.
 */
export async function rollItemFromTables(kind, items) {
  const tables = await configuredTables(kind);
  if (!tables.length) return null;
  const table = tables[Math.floor(Math.random() * tables.length)].doc;
  try {
    const res = await table.roll();
    const r = res?.results?.[0] ?? res?.results?.contents?.[0];
    if (!r) return null;
    if (r.documentUuid) {
      const byUuid = items.find((i) => i.uuid === r.documentUuid);
      if (byUuid) return byUuid;
      const doc = await fromUuid(r.documentUuid).catch(() => null);
      if (doc) {
        const byName = items.find((i) => i.name.toLowerCase() === doc.name.toLowerCase());
        if (byName) return byName;
      }
    }
    const txt = resultText(r).toLowerCase();
    if (!txt) return null;
    return items.find((i) => i.name.toLowerCase() === txt)
      ?? items.find((i) => txt.includes(i.name.toLowerCase()))
      ?? null;
  } catch (_e) {
    return null;
  }
}

/**
 * Per-ancestry filter for a configured table: hide it when its name mentions a
 * DIFFERENT installed ancestry; show it when it mentions this one or none at
 * all (a generic table). Longest-match rule so "Half-Elf Names" counts as
 * mentioning Half-Elf, not Elf. `allAncestryNames` comes from the installed
 * ancestry list — nothing hardcoded.
 */
export function tableMatchesAncestry(tableName, ancestryName, allAncestryNames) {
  const t = String(tableName).toLowerCase();
  const matched = allAncestryNames.filter((n) => t.includes(n.toLowerCase()));
  const maximal = matched.filter((n) =>
    !matched.some((m) => m !== n && m.toLowerCase().includes(n.toLowerCase())));
  return maximal.length === 0 || maximal.some((n) => n.toLowerCase() === String(ancestryName).toLowerCase());
}
