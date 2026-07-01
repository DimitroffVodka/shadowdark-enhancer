/**
 * Data helpers for the character builder. Thin wrappers over the Shadowdark
 * system's own compendium loaders + Foundry roll/enrich utilities, so the
 * builder always reflects the live installed content.
 */

import { MODULE_ID } from "../module-id.mjs";

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
 * Resolve a RollTable document by UUID (compendium or world). Returns null if
 * unavailable.
 */
export async function resolveTable(uuid) {
  if (!uuid) return null;
  try { return await fromUuid(uuid); } catch (_e) { return null; }
}

/**
 * Find an ancestry's trinket table. Shadowdark ships per-ancestry trinket
 * tables named "<Ancestry> Trinket" (world RollTable directory or a RollTable
 * compendium such as world.shadowdark-enhancer--roll-tables), so trinkets are
 * resolved by ancestry name — there is no global trinket-table setting.
 */
export async function findTrinketTable(ancestryName) {
  if (!ancestryName) return null;
  const want = `${ancestryName} trinket`.toLowerCase();

  const world = game.tables?.find((t) => t.name.toLowerCase() === want);
  if (world) return world;

  for (const p of game.packs.filter((pk) => pk.documentName === "RollTable")) {
    // eslint-disable-next-line no-await-in-loop
    const idx = await p.getIndex();
    const hit = idx.find((e) => e.name.toLowerCase() === want);
    if (hit) return p.getDocument(hit._id);
  }
  return null;
}

/**
 * Stripped text for a TableResult. Different tables store the value in
 * different fields — the enhancer name tables use `description`, while the
 * Nord table leaves `description` an empty string and puts the name in `name`.
 * So pick the first NON-EMPTY of description/text/name (a plain `??` chain
 * would stop at the empty-string `description` and miss `name`).
 */
function resultText(r) {
  for (const field of [r?.description, r?.text, r?.name]) {
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
 */
export async function findTableByName(names, hints = []) {
  const wants = names.map((n) => String(n).toLowerCase().trim());
  const matches = [];
  for (const t of (game.tables ?? [])) {
    if (wants.includes(t.name.toLowerCase().trim())) matches.push({ doc: t, key: "world" });
  }
  for (const p of game.packs.filter((pk) => pk.documentName === "RollTable")) {
    // eslint-disable-next-line no-await-in-loop
    const idx = await p.getIndex();
    for (const e of idx) {
      if (wants.includes(e.name.toLowerCase().trim())) matches.push({ pack: p, id: e._id, key: p.collection.toLowerCase() });
    }
  }
  if (!matches.length) return null;
  let pick = matches;
  if (hints.length) {
    const pref = matches.filter((m) => hints.some((h) => m.key.includes(h)));
    if (pref.length) pick = pref;
  }
  const m = pick[0];
  return m.doc ?? await m.pack.getDocument(m.id);
}

/**
 * Selectable Name / Trinket table sources for the Ancestry step. Each source
 * resolves an ancestry's name + trinket table by the naming convention its
 * pack uses. The GM enables one or more via world settings; when several are
 * enabled the builder shows a source picker. Resolvers return null when that
 * source has no matching table installed, so a source with missing tables
 * simply drops out of the available list.
 */
export const TABLE_SOURCES = [
  {
    id: "core",
    label: "SDE.charBuilder.ancestry.source.core",
    setting: "charBuilderTableSrcCore",
    name: (a) => findTableByName([`${a} Names`, `Character Names: ${a}`], ["shadowdark-enhancer", "shadowdark.rollable"]),
    trinket: (a) => findTableByName([`${a} Trinket`], ["shadowdark-enhancer"]),
  },
  {
    id: "western-reaches",
    label: "SDE.charBuilder.ancestry.source.wr",
    setting: "charBuilderTableSrcWesternReaches",
    name: (a) => findTableByName([`WR Character Names: ${a}`, `WR: Character Names: ${a}`], ["western-reaches", "wr-"]),
    trinket: (a) => findTableByName([`${a} Trinket`], ["western-reaches", "wr-"]),
  },
  {
    id: "nord",
    label: "SDE.charBuilder.ancestry.source.nord",
    setting: "charBuilderTableSrcNord",
    name: (_a) => findTableByName(["Nord Names", "Cursed Scroll 3 p16: Nord Names"]),
    trinket: (_a) => Promise.resolve(null),
  },
];

/** Ids of the enabled Name/Trinket sources (world settings); always ≥ ["core"]. */
export function enabledSourceIds() {
  const out = [];
  for (const s of TABLE_SOURCES) {
    try { if (game.settings.get(MODULE_ID, s.setting)) out.push(s.id); }
    catch (_e) { /* not registered yet */ }
  }
  return out.length ? out : ["core"];
}
