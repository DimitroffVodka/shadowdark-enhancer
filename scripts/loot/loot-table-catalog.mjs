/**
 * Shadowdark Enhancer — Loot / treasure table catalog + classifier (data only).
 *
 * A metadata-only catalog of the loot & treasure roll tables across Core, the
 * Cursed Scroll zines, and the Western Reaches guide, plus the helpers the Loot
 * Generator and Loot Setup use to:
 *   • classify a RollTable (world doc or pack index entry) as a loot/treasure
 *     table — `isLootTable`;
 *   • discover the loot tables actually present in the world + the sde-tables
 *     suite pack + the Shadowdark system pack — `gatherLootTables`;
 *   • census the catalog against what's present so missing entries can be
 *     unlocked through the Importer Hub — `gatherLootLibraryCensus`.
 *
 * Ships ZERO book content — only table NAMES, source keys, and page cites (the
 * same metadata the Importer Hub's manage tree already exposes). The actual
 * table rows are reconstructed from the user's own PDF via the importer unlock.
 *
 * Source keys (`src`) match CHAR_SOURCES in char-content-manifest.mjs so the
 * unlock seed drives the identical charSeedPaste flow (PDF deep-link + grab).
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";

/** The Shadowdark system ships exactly one treasure table in its compendium. */
export const SYSTEM_TABLES_PACK = "shadowdark.rollable-tables";
/** The module's own tables suite pack (descriptor id). */
export const SUITE_TABLES_PACK = "sde-tables";
/** World setting: extra picker uuids added by hand (mainly compendium tables). */
export const LOOT_PICKER_SETTING = "lootPickerTables";

/** The GM's manually-added Loot Generator picker uuids (compendium tables). */
export function getPickerExtras() {
  const arr = game.settings.get(MODULE_ID, LOOT_PICKER_SETTING);
  return Array.isArray(arr) ? arr : [];
}

/** Pack-index fields needed to read our flags off a compendium index entry. */
const INDEX_FLAG_FIELDS = [
  "flags.shadowdark-enhancer.isLootTable",
  "flags.shadowdark-enhancer.tableType",
  "flags.shadowdark-enhancer.manifestId",
];

/**
 * The four leveled Core treasure tables that feed the Loot Generator's tier
 * slots. Names/pages match core-table-groups.mjs (the extractor's own cites);
 * the loot engine bins each by its tier band.
 */
export const LOOT_TIER_ENTRIES = [
  { tier: "0-3", name: "TREASURE 0-3", src: "CORE", page: "270-271", contentId: "core/treasure-0-3", label: "Treasure — Levels 0-3" },
  { tier: "4-6", name: "TREASURE 4-6", src: "CORE", page: "272-273", contentId: "core/treasure-4-6", label: "Treasure — Levels 4-6" },
  { tier: "7-9", name: "TREASURE 7-9", src: "CORE", page: "274-275", contentId: "core/treasure-7-9", label: "Treasure — Levels 7-9" },
  { tier: "10+", name: "TREASURE 10+", src: "CORE", page: "276-277", contentId: "core/treasure-10",  label: "Treasure — Levels 10+" },
];

/** Count of the four treasure tiers bound in a lootTierTables map (pure). */
export function boundCount(map = {}) {
  return LOOT_TIER_ENTRIES.filter((e) => map[e.tier]).length;
}

/**
 * The full browsable loot/treasure library, grouped by source. Each entry is an
 * unlockable table; the Core bands double as the tier sources above. Western
 * Reaches ships no dedicated treasure roll table (it reuses the Core treasure
 * tables), so it carries no entries here — surfaced as an empty group note.
 */
export const LOOT_LIBRARY = [
  {
    src: "CORE", label: "Core Rulebook",
    entries: [
      ...LOOT_TIER_ENTRIES.map(({ tier, name, src, page, contentId }) => ({ tier, name, src, page, contentId })),
      { name: "Luxury Items", src: "CORE", page: "279", contentId: "core/luxury-items" },
    ],
  },
  {
    src: "CURSED", label: "Cursed Scroll",
    entries: [
      { name: "Cursed Scroll 1 p68: Diabolical Treasure", src: "CS1", page: "68", displayName: "Diabolical Treasure", contentId: "cs1/diabolical-treasure" },
      { name: "Sea Wolf Plunder From Distant Lands", src: "CS3", page: "68", contentId: "cs3/sea-wolf-plunder" },
    ],
  },
  {
    src: "WR", label: "Western Reaches",
    // No dedicated WR treasure table exists in the content set — WR adventures
    // roll on the Core treasure tables above.
    entries: [],
  },
];

/** Manifest ids known to be loot/treasure tables (exact-match fast path). */
const LOOT_MANIFEST_IDS = new Set([
  "core-treasure-7-9", "core-treasure-10", "core-luxury-items", "core-unique-feature",
]);

/** Broad name signal for treasure/loot tables (renamed copies still match). */
const LOOT_NAME_RE = /\btreasure\b|\bplunder\b|luxury items/i;

// ── Name normalization (mirrors the manage tree's suffix-tolerant matching) ──

/** Strip a "Book pNN:" rep-prefix, e.g. "Cursed Scroll 1 p68: Diabolical…". */
function stripRepPrefix(s) {
  return String(s ?? "").replace(/^.*?p\.?\s*\d+[a-z]?\s*:\s*/i, "").trim();
}

/** Canonical comparison form: rep-prefix stripped, collapsed, lower-cased. */
function normName(s) {
  return stripRepPrefix(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * True when `candidate` (a present table's name) satisfies an `entry` name —
 * exact, or a "Source - Name" / "Book pNN: Name" prefixed copy of it.
 */
function nameMatches(candidate, entryName) {
  const c = normName(candidate);
  const e = normName(entryName);
  return !!e && (c === e || c.endsWith(` - ${e}`) || c.endsWith(`: ${e}`));
}

/** Read our three flags off a RollTable doc OR a compendium index entry. */
function readFlags(t) {
  if (typeof t?.getFlag === "function") {
    return {
      isLootTable: t.getFlag(MODULE_ID, "isLootTable"),
      tableType: t.getFlag(MODULE_ID, "tableType"),
      manifestId: t.getFlag(MODULE_ID, "manifestId"),
    };
  }
  return t?.flags?.[MODULE_ID] ?? {};
}

/**
 * Classify a RollTable (world document OR compendium index entry) as a loot /
 * treasure table. True when it carries the isLootTable flag, was filed by the
 * importer as loot/treasure, matches a known loot manifest id, or its name
 * reads as a treasure table. Pack index entries only expose flags when the
 * index was fetched with INDEX_FLAG_FIELDS (see gatherLootTables).
 */
export function isLootTable(t) {
  if (!t) return false;
  const f = readFlags(t);
  if (f.isLootTable === true) return true;
  const tt = f.tableType ? String(f.tableType).toLowerCase() : "";
  if (tt === "loot" || tt === "treasure") return true;
  if (f.manifestId && LOOT_MANIFEST_IDS.has(f.manifestId)) return true;
  return LOOT_NAME_RE.test(t.name ?? "");
}

/** Build the unlock seed the Importer Hub consumes for a library entry. */
export function unlockSeedFor(entry) {
  return {
    name: entry.name,
    src: entry.src,
    type: "Table",
    contentId: entry.contentId ?? null,
    page: entry.page ?? null,
  };
}

// ── Live scans ──────────────────────────────────────────────────────────────

/**
 * Every RollTable visible to the loot system: world tables, the sde-tables
 * suite pack (with our flags), and the Shadowdark system pack. Returns light
 * `{ uuid, name, group, ...flags }` records — never full documents.
 */
async function scanAllTables() {
  const out = [];
  // Classify against the real doc / index entry (readFlags understands both),
  // then store a flat `loot` boolean — the callers read name + loot, never the
  // raw flags, so flattening the flags onto the record would defeat the
  // classifier (its readFlags looks under .flags[MODULE_ID], not the top level).
  for (const t of game.tables.contents) {
    out.push({ uuid: t.uuid, name: t.name, group: "World", loot: isLootTable(t) });
  }

  const suite = findSuitePack(SUITE_TABLES_PACK);
  if (suite) {
    try {
      const index = await suite.getIndex({ fields: INDEX_FLAG_FIELDS });
      for (const e of index) {
        out.push({
          uuid: `Compendium.${suite.collection}.RollTable.${e._id}`,
          name: e.name, group: "Compendium", loot: isLootTable(e),
        });
      }
    } catch (_) { /* pack not ready — appears on next render */ }
  }

  const sys = game.packs.get(SYSTEM_TABLES_PACK);
  if (sys) {
    try {
      const index = await sys.getIndex();
      for (const e of index) {
        out.push({ uuid: `Compendium.${sys.collection}.RollTable.${e._id}`, name: e.name, group: "Shadowdark", loot: isLootTable(e) });
      }
    } catch (_) { /* ignore */ }
  }
  return out;
}

/**
 * Curated loot/treasure tables that actually exist, across world + compendia.
 * Deduped by uuid, sorted by name. Feeds the Loot Generator picker and the Loot
 * Setup dropdowns (so both show only loot tables, world AND compendium).
 */
export async function gatherLootTables() {
  const all = await scanAllTables();
  const seen = new Set();
  const tables = [];
  for (const t of all) {
    if (!t.loot || seen.has(t.uuid)) continue;
    seen.add(t.uuid);
    tables.push({ uuid: t.uuid, name: t.name, group: t.group });
  }
  // Manually-added picker uuids (compendium tables that can't be flagged).
  for (const uuid of getPickerExtras()) {
    if (seen.has(uuid)) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc?.documentName !== "RollTable") continue;
    seen.add(uuid);
    tables.push({ uuid, name: doc.name, group: uuid.startsWith("Compendium.") ? "Compendium" : "World" });
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

/**
 * Every RollTable NOT already in the Loot Generator picker — world tables and
 * all RollTable compendiums — for the "Add to Loot Generator" dropdown.
 */
export async function gatherAddableTables() {
  const current = new Set((await gatherLootTables()).map((t) => t.uuid));
  const out = [];
  for (const t of game.tables.contents) {
    if (!current.has(t.uuid)) out.push({ uuid: t.uuid, name: t.name, group: "World" });
  }
  for (const pack of game.packs) {
    if (pack.documentName !== "RollTable") continue;
    let index;
    try { index = await pack.getIndex(); } catch (_) { continue; }
    for (const e of index) {
      const uuid = `Compendium.${pack.collection}.RollTable.${e._id}`;
      if (!current.has(uuid)) out.push({ uuid, name: e.name, group: pack.metadata.label });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.group.localeCompare(b.group));
  return out;
}

/**
 * Removable picker entries: world tables carrying the isLootTable flag, plus
 * the manually-added compendium uuids. (Name-classified treasure tables are
 * inherent and not listed here.) Feeds the Loot Setup "manage" list.
 */
export async function gatherPickerManaged() {
  const out = [];
  const seen = new Set();
  for (const t of game.tables.contents) {
    if (t.getFlag(MODULE_ID, "isLootTable") === true) { out.push({ uuid: t.uuid, name: t.name, group: "World" }); seen.add(t.uuid); }
  }
  for (const uuid of getPickerExtras()) {
    if (seen.has(uuid)) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc?.documentName !== "RollTable") continue;
    seen.add(uuid);
    out.push({ uuid, name: doc.name, group: uuid.startsWith("Compendium.") ? "Compendium" : "World" });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Census the LOOT_LIBRARY catalog against what's present. Each entry resolves to
 * either a present table (uuid + where) or an unlock seed for the Importer Hub.
 * Grouped by source for the Loot Setup library section.
 */
export async function gatherLootLibraryCensus() {
  const all = await scanAllTables();
  const resolve = (entry) => all.find((t) => nameMatches(t.name, entry.name)) ?? null;

  return LOOT_LIBRARY.map((group) => ({
    src: group.src,
    label: group.label,
    entries: group.entries.map((e) => {
      const hit = resolve(e);
      return {
        name: e.name,
        displayName: e.displayName ?? stripRepPrefix(e.name),
        src: e.src,
        page: e.page ?? null,
        tier: e.tier ?? null,
        present: !!hit,
        uuid: hit?.uuid ?? null,
        where: hit?.group ?? null,
        seed: hit ? null : unlockSeedFor(e),
      };
    }),
  }));
}

/**
 * Resolve the present table matching a single tier entry (world/pack/system),
 * or null. Used by the Loot Setup tier slots to offer a one-click bind.
 */
export async function findTierTable(tier) {
  const entry = LOOT_TIER_ENTRIES.find((t) => t.tier === tier);
  if (!entry) return null;
  const all = await scanAllTables();
  const hit = all.find((t) => nameMatches(t.name, entry.name));
  return hit ? { uuid: hit.uuid, name: hit.name, where: hit.group } : null;
}
