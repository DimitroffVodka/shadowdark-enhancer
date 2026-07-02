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
    // eslint-disable-next-line no-await-in-loop
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

// --- GM-selected Name/Trinket table sources ---------------------------------

const KIND_SETTINGS = {
  name: "charBuilderNameTables",
  trinket: "charBuilderTrinketTables",
  background: "charBuilderBackgroundTables",
  deity: "charBuilderDeityTables",
};
const _configuredDocCache = new Map();   // uuid → RollTable doc (session-lived)

/**
 * The RollTables the GM checked in the Table Sources settings menu for a kind
 * ("name" | "trinket"), resolved to docs. Unresolvable or empty tables drop out.
 */
export async function configuredTables(kind) {
  let uuids = [];
  try { uuids = game.settings.get(MODULE_ID, KIND_SETTINGS[kind]) || []; }
  catch (_e) { /* not registered yet */ }
  const out = [];
  for (const u of uuids) {
    let doc = _configuredDocCache.get(u);
    // eslint-disable-next-line no-await-in-loop
    if (doc === undefined) { doc = await fromUuid(u).catch(() => null); _configuredDocCache.set(u, doc); }
    if (doc?.results?.size > 0) {
      const origin = doc.pack
        ? (game.packs.get(doc.pack)?.title ?? doc.pack)
        : game.i18n.localize("SDE.charBuilder.tableSources.world");
      out.push({ uuid: u, name: doc.name, origin, doc });
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

/**
 * One-shot seed of the table-source arrays from the pre-menu boolean settings
 * (charBuilderTableSrcCore/WesternReaches/Nord) — resolves the tables each
 * enabled source would have matched and stores their UUIDs. GM-only, on ready.
 */
export async function migrateTableSources() {
  if (!game.user.isGM) return;
  try {
    if (game.settings.get(MODULE_ID, "charBuilderTableSrcMigrated")) return;
    const existing = [
      ...game.settings.get(MODULE_ID, "charBuilderNameTables"),
      ...game.settings.get(MODULE_ID, "charBuilderTrinketTables"),
    ];
    if (existing.length) {
      await game.settings.set(MODULE_ID, "charBuilderTableSrcMigrated", true);
      return;
    }
    const core = game.settings.get(MODULE_ID, "charBuilderTableSrcCore");
    const wr = game.settings.get(MODULE_ID, "charBuilderTableSrcWesternReaches");
    const nord = game.settings.get(MODULE_ID, "charBuilderTableSrcNord");

    const names = new Set();
    const trinkets = new Set();
    for (const a of await loadAncestries()) {
      if (core) {
        const nt = await coreNameTable(a);
        if (nt) names.add(nt.uuid);
        const tt = await findTableByName([`${a.name} Trinket`], ["shadowdark-enhancer"]);
        if (tt) trinkets.add(tt.uuid);
      }
      if (wr) {
        const nt = await findTableByName(
          [`WR Character Names: ${a.name}`, `WR: Character Names: ${a.name}`], ["western-reaches", "wr-"]);
        if (nt) names.add(nt.uuid);
        const tt = await findTableByName([`${a.name} Trinket`], ["western-reaches", "wr-"], { requireHints: true });
        if (tt) trinkets.add(tt.uuid);
      }
    }
    if (nord) {
      const nt = await findTableByName(["Nord Names", "Cursed Scroll 3 p16: Nord Names"]);
      if (nt) names.add(nt.uuid);
    }
    await game.settings.set(MODULE_ID, "charBuilderNameTables", [...names]);
    await game.settings.set(MODULE_ID, "charBuilderTrinketTables", [...trinkets]);
    await game.settings.set(MODULE_ID, "charBuilderTableSrcMigrated", true);
    console.log(`${MODULE_ID} | seeded char-builder table sources: ${names.size} name, ${trinkets.size} trinket`);
  } catch (e) {
    console.error(`${MODULE_ID} | table-source migration failed:`, e);
  }
}
