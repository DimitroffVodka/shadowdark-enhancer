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

/** Build choose-dropdown options ({ value, label }) from a RollTable's results. */
export function tableOptions(table) {
  if (!table?.results) return [];
  const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return table.results.contents
    .map((r) => { const v = strip(r.description ?? r.text ?? r.name); return { value: v, label: v }; })
    .filter((o) => o.value);
}

/** Roll a resolved RollTable document (no chat), returning stripped result text. */
export async function rollTableDoc(table) {
  if (!table?.roll) return null;
  try {
    const res = await table.roll();
    const r = res?.results?.[0] ?? res?.results?.contents?.[0];
    if (!r) return null;
    return String(r.description ?? r.text ?? r.name ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
  } catch (_e) {
    return null;
  }
}
