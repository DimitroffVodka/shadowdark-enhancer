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
import { MODULE_ID } from "./module-id.mjs";

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
  { key: "classes",        id: "classes",             type: "Item", label: "Classes",             charOption: true },
  { key: "talents",        id: "talents",             type: "Item", label: "Talents",             charOption: true },
  { key: "classAbilities", id: "class-abilties",      type: "Item", label: "Class Abilties",      charOption: true },
  { key: "spells",         id: "spells",              type: "Item", label: "Spells",              charOption: true },
  { key: "backgrounds",    id: "background",          type: "Item", label: "Background",          charOption: true },
  { key: "ancestries",     id: "ancestries",          type: "Item", label: "Ancestries",          charOption: true },
  { key: "languages",      id: "languages",           type: "Item", label: "Languages",           charOption: true },
  { key: "patronsDeities", id: "patrons-and-deities", type: "Item", label: "Patrons and Deities", charOption: true },
];

/** Sidebar compendium folder label for the entire suite. */
export const SUITE_FOLDER_LABEL = "Shadowdark Enhancer";

/**
 * Sidebar compendium sub-folder for the Character-Options packs (Classes,
 * Talents, Spells, Ancestries, …). Nested under SUITE_FOLDER_LABEL so the whole
 * managed suite stays under one top-level folder while mirroring the system's
 * "Character Options" grouping. Descriptors carry `charOption: true`.
 */
export const CHAR_OPTIONS_FOLDER_LABEL = "Character Options";

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
 *   cs1..cs6 / "Cursed Scroll N"  → "CS1".."CS6"
 *   pgwr / gmgwr / wr / "Western Reaches" → "Western Reaches"
 *   core / "Core Rulebook" → "CORE"
 *   custom / "" / null / undefined → "Custom"
 *   anything else → upper-cased id
 *
 * Both the short keys (CHAR_SOURCES keys, manage-tree `src`) and the long book
 * labels (the Source dropdown's values, and `CHAR_SOURCES[k].label`, which every
 * seed path stamps) must fold to the SAME short code — the census skeleton in
 * manage-tree.mjs is keyed by the short form. Without the long-label cases an
 * import files under "CURSED SCROLL 1" while the CS1 node stays at have: 0
 * forever, and a duplicate all-caps leaf appears beside it.
 * @param {string|null|undefined} sourceId
 * @returns {string}
 */
export function sourceFolderName(sourceId) {
  const s = String(sourceId ?? "").trim().toLowerCase();
  if (!s || s === "custom") return "Custom";
  if (/^cs[1-6]$/.test(s)) return s.toUpperCase();
  const cs = s.match(/^cursed scroll\s*([1-6])$/);
  if (cs) return `CS${cs[1]}`;
  if (s === "pgwr" || s === "gmgwr" || s === "wr" || s === "western reaches") return "Western Reaches";
  if (s === "core" || s === "core rulebook") return "CORE";
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
  // v13 namespaced the global under foundry.documents.collections; fall back to
  // the legacy global for older cores (module minimum is v13).
  const CompendiumCollectionCls =
    foundry.documents?.collections?.CompendiumCollection ?? CompendiumCollection;
  let pack = findSuitePack(descriptor.id);
  if (!pack) {
    pack = await CompendiumCollectionCls.createCompendium({
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

  // Find-or-create the top-level sidebar "Compendium" folder.
  let suiteFolder = game.folders?.find(
    (f) => f.type === "Compendium" && f.name === SUITE_FOLDER_LABEL
  );
  if (!suiteFolder) {
    suiteFolder = await Folder.create({ name: SUITE_FOLDER_LABEL, type: "Compendium" });
  }

  // Find-or-create the "Character Options" sub-folder nested under the suite
  // folder — the home for the char-option packs (Talents, Classes, Spells, …).
  let charFolder = game.folders?.find(
    (f) => f.type === "Compendium" && f.name === CHAR_OPTIONS_FOLDER_LABEL &&
      (f.folder?.id ?? null) === suiteFolder.id
  );
  if (!charFolder) {
    try {
      charFolder = await Folder.create({
        name: CHAR_OPTIONS_FOLDER_LABEL, type: "Compendium", folder: suiteFolder.id,
      });
    } catch (_) {}
  }

  // Ensure all packs; char-option packs go under "Character Options", the rest
  // directly under the suite folder.
  const packs = {};
  for (const desc of SUITE_PACKS) {
    const pack = await ensurePack(desc);
    const targetFolder = desc.charOption ? (charFolder ?? suiteFolder) : suiteFolder;
    // Assign pack into its sidebar folder if not already there.
    if (targetFolder && pack.folder !== targetFolder.id) {
      try {
        await pack.configure({ folder: targetFolder.id });
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

/**
 * Find-or-create a nested folder path inside a pack (e.g. Spells → Wizard →
 * Tier 1). Blank/nullish segments are skipped. Each level is matched by name
 * under its parent, so sibling folders with the same name in different branches
 * don't collide. Returns the leaf folder id (or null on failure / empty path).
 *
 * @param {CompendiumCollection} pack
 * @param {Array<string|null|undefined>} names
 * @returns {Promise<string|null>}
 */
export async function ensureFolderPath(pack, names) {
  const segments = (names || []).map((n) => String(n ?? "").trim()).filter(Boolean);
  let parentId = null;
  try {
    for (const name of segments) {
      let folder = pack.folders?.find?.((f) => f.name === name && (f.folder?.id ?? null) === parentId);
      if (!folder) {
        folder = await Folder.create(
          { name, type: pack.documentName, folder: parentId },
          { pack: pack.collection }
        );
      }
      parentId = folder?.id ?? parentId;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | ensureFolderPath failed (${segments.join(" / ")}):`, err);
  }
  return parentId;
}

/**
 * Non-destructive "replace" for importer conflict resolution (PDF-parser
 * review 2026-07-11 #2). The old delete-then-create pattern lost BOTH copies
 * when the new payload failed validation, and always churned the UUID
 * (breaking journal/table @UUID links — the reason relink-tables exists).
 *
 * Strategy ladder:
 *  1. Same-type existing doc → update IN PLACE (`recursive: false`, so the
 *     provided top-level objects replace wholesale and the result matches a
 *     fresh create), then swap embedded rows (Actor items / RollTable
 *     results). UUID and inbound links survive.
 *  2. Type mismatch or in-place failure → CREATE the replacement first
 *     (packs allow duplicate names), delete the original only after the
 *     create succeeded. Any create failure leaves the original untouched.
 *
 * @param {Document} oldDoc   Existing compendium document being replaced.
 * @param {object} payload    Create-shaped data (may include `items`/`results`).
 * @param {CompendiumCollection} pack
 * @returns {Promise<{doc: Document, mode: "updated"|"recreated"}>}
 * @throws when neither path produced a replacement (original preserved).
 */
export async function replaceDocument(oldDoc, payload, pack) {
  const EMBEDDED = { Actor: ["items", "Item"], RollTable: ["results", "TableResult"], Item: ["effects", "ActiveEffect"] };
  const [field, embeddedName] = EMBEDDED[oldDoc.documentName] ?? [null, null];
  const docData = { ...payload };
  delete docData._id;
  const rows = field ? (docData[field] ?? []) : [];
  if (field) delete docData[field];

  if (!docData.type || docData.type === oldDoc.type) {
    try {
      await oldDoc.update(docData, { recursive: false });
      if (field) {
        const oldIds = oldDoc.getEmbeddedCollection(embeddedName).map((r) => r.id);
        if (oldIds.length) await oldDoc.deleteEmbeddedDocuments(embeddedName, oldIds);
        if (rows.length) await oldDoc.createEmbeddedDocuments(embeddedName, rows);
      }
      return { doc: oldDoc, mode: "updated" };
    } catch (err) {
      console.warn(`${MODULE_ID} | replaceDocument: in-place update of "${oldDoc.name}" failed (${err.message}) — falling back to create-then-delete`);
    }
  }

  const cls = oldDoc.constructor;
  const created = await cls.create(payload, { pack: pack.collection });
  if (!created) throw new Error(`replacement create for "${payload?.name}" returned nothing — original kept`);
  await oldDoc.delete();
  return { doc: created, mode: "recreated" };
}

/**
 * Commit-time HTML sanitizer (PDF-parser review 2026-07-11 #1). Parsers
 * escape pasted text at construction; this second pass at the Foundry-bound
 * commit choke points also covers preview-EDITED HTML (the hub lets a GM
 * type markup into description fields). Uses Foundry's supported sanitizer;
 * plain text and safe markup pass through unchanged.
 * @param {string} html
 * @returns {string}
 */
export function cleanImportHtml(html) {
  const s = String(html ?? "");
  if (!s) return s;
  try {
    const clean = globalThis.foundry?.utils?.cleanHTML;
    if (typeof clean === "function") return clean(s);
    // Sanitizer unavailable (API rename / unsupported Foundry): fail CLOSED —
    // escape rather than persist raw markup, matching the catch branch below.
    // (review 2026-07-12 #6)
    console.warn(`${MODULE_ID} | cleanImportHtml: foundry.utils.cleanHTML unavailable — storing escaped text`);
    return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  } catch (err) {
    console.warn(`${MODULE_ID} | cleanImportHtml: sanitize failed — storing escaped text`, err);
    return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
