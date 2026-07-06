/**
 * Shadowdark Enhancer — Managed Compendium Suite foundation.
 *
 * Find-or-create layer for the five world packs (sde-actors, sde-items,
 * sde-tables, sde-journal, sde-scenes), grouped under a "Shadowdark Enhancer"
 * sidebar compendium folder, with per-source folders inside each pack.
 *
 * Detection is label-based per the verified v14 contract: world-compendium
 * flags don't round-trip through metadata.flags, so metadata.label is the
 * dependable signal. Never calls deleteCompendium (D6/D-06).
 *
 * GM-only mutations. Pure helpers (sourceFolderName, packOwnership) are
 * Foundry-free so node:test can import them directly.
 */
import { MODULE_ID } from "../module-id.mjs";

// ─── Pack descriptors ────────────────────────────────────────────────────────

/**
 * The five managed world packs. Ids are stable across worlds; labels are
 * the detection signal (flags don't round-trip in v14).
 * @type {Array<{key: string, id: string, type: string, label: string}>}
 */
export const SUITE_PACKS = [
  { key: "actors",  id: "sde-actors",  type: "Actor",        label: "Shadowdark Enhancer — Actors"      },
  { key: "items",   id: "sde-items",   type: "Item",         label: "Shadowdark Enhancer — Items"       },
  { key: "tables",  id: "sde-tables",  type: "RollTable",    label: "Shadowdark Enhancer — Roll Tables" },
  { key: "journal", id: "sde-journal", type: "JournalEntry", label: "Shadowdark Enhancer — Journals"    },
  { key: "scenes",  id: "sde-scenes",  type: "Scene",        label: "Shadowdark Enhancer — Scenes"      },
  // Character-Options packs. These are world compendiums whose LABELS slugify to
  // their collection ids (Classes→world.classes, "Class Abilties"→
  // world.class-abilties, …), so a fresh world recreates the identical
  // `world.<slug>` collection on import — keeping every cross-pack `@UUID`
  // reference (class→talent, spell→class, table→doc, ancestry→talent) valid.
  // Empty structural packs (Languages, Patrons and Deities) are carried so the
  // imported suite mirrors the source exactly.
  { key: "classes",        id: "classes",             type: "Item", label: "Classes"             },
  { key: "talents",        id: "talents",             type: "Item", label: "Talents"             },
  { key: "classAbilities", id: "class-abilties",      type: "Item", label: "Class Abilties"      },
  { key: "spells",         id: "spells",              type: "Item", label: "Spells"              },
  { key: "backgrounds",    id: "background",          type: "Item", label: "Background"          },
  { key: "ancestries",     id: "ancestries",          type: "Item", label: "Ancestries"          },
  { key: "languages",      id: "languages",           type: "Item", label: "Languages"           },
  { key: "patronsDeities", id: "patrons-and-deities", type: "Item", label: "Patrons and Deities" },
];

/** Sidebar compendium folder label for the entire suite. */
export const SUITE_FOLDER_LABEL = "Shadowdark Enhancer";

// ─── Pure helpers (Foundry-free, node:test importable) ───────────────────────

/**
 * Ownership level constants. v14 compendium ownership config maps user ROLE
 * names to ownership level NAMES (strings) — numeric levels are silently
 * rejected by pack.configure, leaving the world-pack default
 * (PLAYER: OBSERVER) on every pack. Verified live 2026-06-10.
 */
const OBSERVER = "OBSERVER";
const NONE     = "NONE";

/**
 * Map a source id to its display label for pack sub-folders.
 *   cs1..cs6  → "CS1".."CS6"
 *   pgwr / gmgwr / wr → "Western Reaches"
 *   custom / "" / null / undefined → "Custom"
 *   anything else → upper-cased id
 * @param {string|null|undefined} sourceId
 * @returns {string}
 */
export function sourceFolderName(sourceId) {
  const s = String(sourceId ?? "").trim().toLowerCase();
  if (!s || s === "custom") return "Custom";
  if (/^cs[1-6]$/.test(s)) return s.toUpperCase();
  if (s === "pgwr" || s === "gmgwr" || s === "wr") return "Western Reaches";
  return s.toUpperCase();
}

/**
 * Return the default-ownership map for a given pack id.
 * sde-actors → OBSERVER for PLAYER (monster @UUID links resolve on player sheets, D-07).
 * All other suite packs → NONE for PLAYER (GM-only).
 * @param {string} packId
 * @returns {{ PLAYER: number }}
 */
export function packOwnership(packId) {
  return { PLAYER: packId === "sde-actors" ? OBSERVER : NONE };
}

// ─── Pack lookup ─────────────────────────────────────────────────────────────

/**
 * Locate a managed world pack by its descriptor id or key.
 * Match criteria (label is the durable fallback per v14 contract):
 *   p.metadata.packageType === "world"
 *   AND (p.collection ends with the pack id  OR  p.metadata.label === descriptor.label)
 * @param {string} idOrKey  e.g. "sde-actors" or "actors"
 * @returns {CompendiumCollection|undefined}
 */
export function findSuitePack(idOrKey) {
  const desc = SUITE_PACKS.find((d) => d.id === idOrKey || d.key === idOrKey);
  if (!desc) return undefined;
  return game.packs.find(
    (p) =>
      p.metadata?.packageType === "world" &&
      (p.collection?.endsWith(`.${desc.id}`) ||
       p.collection?.endsWith(`${desc.id}`) ||
       p.metadata?.label === desc.label)
  );
}

// ─── Pack + folder find-or-create ────────────────────────────────────────────

/**
 * Find-or-create one world pack for a descriptor; unlock if locked; apply
 * ownership. Mirrors ensureMonsterPack's try/catch tolerance.
 * @param {{ key: string, id: string, type: string, label: string }} descriptor
 * @returns {Promise<CompendiumCollection>}
 */
export async function ensurePack(descriptor) {
  let pack = findSuitePack(descriptor.id);
  if (!pack) {
    pack = await CompendiumCollection.createCompendium({
      label: descriptor.label,
      type: descriptor.type,
      packageType: "world",
    });
  }
  if (pack.locked) {
    try { await pack.configure({ locked: false }); } catch (_) {}
  }
  const own = packOwnership(descriptor.id);
  try {
    await pack.configure({ ownership: { PLAYER: own.PLAYER } });
  } catch (_) {}
  return pack;
}

/**
 * Find-or-create the "Shadowdark Enhancer" sidebar compendium folder; find-or-create
 * all five packs inside it; return a map of CompendiumCollections.
 *
 * GM-gate at top (mirrors createMonster pattern — T-09-01).
 *
 * @returns {Promise<{actors: CompendiumCollection, items: CompendiumCollection,
 *   tables: CompendiumCollection, journal: CompendiumCollection,
 *   scenes: CompendiumCollection}|undefined>}
 */
export async function ensureSuite() {
  if (!game.user?.isGM) {
    console.warn(`${MODULE_ID} | ensureSuite: GM only`);
    return;
  }

  // Find-or-create the sidebar "Compendium" folder.
  let suiteFolder = game.folders?.find(
    (f) => f.type === "Compendium" && f.name === SUITE_FOLDER_LABEL
  );
  if (!suiteFolder) {
    suiteFolder = await Folder.create({ name: SUITE_FOLDER_LABEL, type: "Compendium" });
  }

  // Ensure all five packs.
  const packs = {};
  for (const desc of SUITE_PACKS) {
    const pack = await ensurePack(desc);
    // Assign pack into the sidebar folder if not already there.
    if (suiteFolder && pack.folder !== suiteFolder.id) {
      try {
        await pack.configure({ folder: suiteFolder.id });
      } catch (_) {}
    }
    packs[desc.key] = pack;
  }

  // Keyed by descriptor key — includes the original actors/items/tables/journal/
  // scenes accessors plus the Character-Options packs (classes, talents, …).
  return packs;
}

/**
 * Find-or-create a compendium sub-folder for a source id inside a pack.
 * The folder name is derived via sourceFolderName(). Document type mirrors
 * the pack's documentName. Returns the folder id, or null on failure.
 *
 * Mirrors monster-importer.ensureSourceFolder (per-source folder inside pack).
 *
 * @param {CompendiumCollection} pack
 * @param {string|null|undefined} sourceId
 * @returns {Promise<string|null>}
 */
export async function ensureSourceFolder(pack, sourceId) {
  const name = sourceFolderName(sourceId);
  try {
    const existing = pack.folders?.find?.((f) => f.name === name);
    if (existing) return existing.id;
    const folder = await Folder.create(
      { name, type: pack.documentName },
      { pack: pack.collection }
    );
    return folder?.id ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | ensureSourceFolder failed (${name}):`, err);
    return null;
  }
}
