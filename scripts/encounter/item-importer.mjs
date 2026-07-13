/**
 * Shadowdark Enhancer — Item importer pipeline (Foundry-bound).
 *
 * Takes parser drafts (item-parser.mjs) and creates Shadowdark Item documents
 * in the managed WORLD Item compendium (`sde-items`), foldered by source,
 * deduped by name. Reuses loot-pack classification/icon mapping and
 * magic-forge's type mapping — A-03 single construction choke point.
 *
 * GM-only. Ships ZERO book content — the GM provides the item text; these
 * items live only in the GM's local world compendium.
 *
 * Exports:
 *   buildItemData(draft) → itemData   — pure, Foundry-free, node-testable
 *   createItem(draft, opts)            — Foundry-bound single-item commit
 *   createItems(drafts, opts)          — Foundry-bound batch commit
 *   ItemImporter = { buildItemData, createItem, createItems }
 */
import { MODULE_ID } from "../module-id.mjs";
import { pickTreasureIcon } from "./loot-pack.mjs";
import { pickShikashiSpellIcon } from "./shikashi-icons.mjs";
import { findSuitePack, ensureSuite, ensurePack, ensureSourceFolder, ensureFolderPath, replaceDocument, cleanImportHtml, SUITE_PACKS } from "./compendium-suite.mjs";
import { LootLinker } from "./loot-linker.mjs";

// ─── Pure construction choke point (A-03) ────────────────────────────────────

/**
 * Convert a parser draft into a system-faithful Shadowdark Item creation payload.
 * This is THE single item-construction choke point (A-03).
 *
 * Routing:
 *   Magic items (draft.riders present with at least one rider keyword):
 *     → type: ({weapon:"Weapon",armor:"Armor"})[lc] ?? "Basic"  (magic-forge mapping)
 *     → description: already HTML (D4 — item-parser guarantees this)
 *     → system.treasure: true
 *     → flags[MODULE_ID].imported: true
 *
 *   Gear/treasure items (no riders, or empty riders):
 *     → type: "Basic"  (loot-pack fabricateTreasureItem shape)
 *     → cost from draft.cost
 *     → slots from draft.slots
 *     → img: draft.img ?? pickTreasureIcon(draft.name)  (A-03 icon reuse)
 *     → system.treasure: true
 *
 * @param {object} draft  from item-parser.mjs (parseItem output)
 * @returns {object}  Foundry Item creation payload
 */
export function buildItemData(draft) {
  const name = draft.name ?? "Unnamed Item";

  // ── Spell path — explicit type:"Spell" from the spell parser. Mirrors the
  // schema in monster-importer.buildFallbackSpell. `class` is expected to be an
  // already-resolved UUID array (see class-index.resolveSpellClass); the parser
  // leaves it empty + carries the class name on draft.className for reference. ──
  if (draft.type === "Spell") {
    const desc = String(draft.description ?? "").trim() || name;
    const tier = Number(draft.tier);
    return {
      name,
      type: "Spell",
      img: draft.img || pickShikashiSpellIcon(name),
      system: {
        class: Array.isArray(draft.class) ? draft.class : [],
        tier: Number.isFinite(tier) ? tier : 1,
        range: draft.range || "close",
        duration: draft.duration ?? { type: "instant", value: "-1" },
        lost: false,
        properties: [],
        source: { title: draft.source?.title ?? "" },
        description: desc.startsWith("<") ? desc : `<p>${desc}</p>`,
        damageType: draft.damageType || "none",
        ...(draft.formula ? { formula: draft.formula } : {}),
      },
      // Alignment tag (lawful/chaotic/neutral) — the char-builder's spell picker
      // gates on flags["shadowdark-extras"].alignment (untagged = universal). The
      // Spell Importer sets draft.alignment; a blank/"universal" value stays untagged.
      flags: {
        [MODULE_ID]: { imported: true },
        ...(draft.alignment && draft.alignment !== "universal"
          ? { "shadowdark-extras": { alignment: draft.alignment } } : {}),
      },
    };
  }

  // ── Character-content paths (unlock flow) — Background/Talent/Class drafts
  // from char-content-manifest.parseCharContent. Minimal system shapes match
  // live shadowdark.* pack documents (FVTT 14 / SD 4.x). ──
  if (draft.type === "Background") {
    return {
      name, type: "Background", img: draft.img || "icons/environment/people/commoner.webp",
      system: {
        description: draft.description ?? "<p></p>",
        source: { title: draft.sourceTitle ?? "" },
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }
  if (draft.type === "Talent") {
    return {
      name, type: "Talent", img: draft.img || "icons/sundries/documents/document-torn-diagram-tan.webp",
      system: {
        description: draft.description ?? "<p></p>",
        level: 1,
        // Ancestry-granted talents (Half-Elf "Adaptable") are talentClass
        // "ancestry"; free-standing talents default to "level".
        talentClass: draft.talentClass ?? "level",
        source: { title: draft.sourceTitle ?? "" },
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }
  if (draft.type === "Ancestry") {
    const lang = draft.languages ?? {};
    return {
      name, type: "Ancestry", img: draft.img || "icons/environment/people/group.webp",
      system: {
        description: draft.description ?? "<p></p>",
        languages: {
          common:        Number(lang.common) || 0,
          rare:          Number(lang.rare) || 0,
          select:        Number(lang.select) || 0,
          selectOptions: Array.isArray(lang.selectOptions) ? lang.selectOptions : [],
          fixed:         Array.isArray(lang.fixed) ? lang.fixed : [],
        },
        talents: Array.isArray(draft.talents) ? draft.talents : [],
        talentChoiceCount: Number(draft.talentChoiceCount) || 0,
        nameTable: "",
        randomWeight: 1,
        source: { title: draft.sourceTitle ?? "" },
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }
  if (draft.type === "Class") {
    return {
      name, type: "Class", img: draft.img || "icons/skills/trades/academics-book-study-runes.webp",
      system: {
        description: draft.description ?? "<p></p>",
        hitPoints: draft.hitPoints || "d6",
        allWeapons: !!draft.allWeapons,
        allMeleeWeapons: !!draft.allMeleeWeapons,
        allRangedWeapons: !!draft.allRangedWeapons,
        allArmor: !!draft.allArmor,
        weapons: [], armor: [],
        source: { title: draft.sourceTitle ?? "" },
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }

  const img = draft.img || pickTreasureIcon(name);

  // Determine if this is a magic item by checking riders
  const riders = draft.riders ?? {};
  const hasMagicRiders =
    (Array.isArray(riders.benefit) && riders.benefit.length > 0) ||
    riders.bonus ||
    riders.curse ||
    riders.personality;

  if (hasMagicRiders) {
    // ── Magic item path — mirrors magic-forge.mjs assembleItemData shape ──
    const lc = String(draft.type ?? "").toLowerCase();
    const sdType = ({ weapon: "Weapon", armor: "Armor" })[lc] ?? "Basic";
    return {
      name,
      type: sdType,
      img,
      system: {
        description: draft.description ?? "<p></p>",
        treasure: true,
        cost: { gp: draft.cost?.gp ?? 0, sp: draft.cost?.sp ?? 0, cp: draft.cost?.cp ?? 0 },
        slots: {
          free_carry: draft.slots?.free_carry ?? 0,
          per_slot:   draft.slots?.per_slot   ?? 1,
          slots_used: draft.slots?.slots_used ?? 1,
        },
        quantity: 1,
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }

  // ── Gear/treasure path — mirrors loot-pack.mjs fabricateTreasureItem shape ──
  return {
    name,
    type: "Basic",
    img,
    system: {
      description: draft.description ?? "<p></p>",
      cost:   { gp: draft.cost?.gp ?? 0, sp: draft.cost?.sp ?? 0, cp: draft.cost?.cp ?? 0 },
      slots:  {
        free_carry: draft.slots?.free_carry ?? 0,
        per_slot:   draft.slots?.per_slot   ?? 1,
        slots_used: draft.slots?.slots_used ?? 1,
      },
      treasure: true,
      quantity: 1,
    },
    flags: { [MODULE_ID]: { imported: true } },
  };
}

// ─── Pure name-uniqueness helper ──────────────────────────────────────────────

/** A pack-index-unique name (`Base (2)`, `Base (3)`, …). Mirrors monster-importer. */
function _uniqueName(index, base) {
  const taken = new Set([...index].map((e) => (e.name ?? "").toLowerCase()));
  let n = 2;
  let cand = `${base} (${n})`;
  while (taken.has(cand.toLowerCase())) { n++; cand = `${base} (${n})`; }
  return cand;
}

// ─── Foundry-bound commit path ────────────────────────────────────────────────

/**
 * Create one draft into the sde-items pack. Conflicts are checked against the
 * PACK INDEX (not game.items). `onConflict(name) → "skip"|"replace"|"rename"`
 * (default "rename"). Replace deletes the existing compendium document by id.
 * GM-gated.
 *
 * @param {object} draft               from item-parser.mjs
 * @param {{ pack?, folder?, source?, onConflict? }} opts
 * @returns {Promise<{uuid?:string, name:string, status:"created"|"skipped"|"replaced"}|null>}
 */
export async function createItem(draft, { pack, folder = null, source = "", onConflict } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import items."); return null; }
  if (!pack) pack = findSuitePack("sde-items") ?? (await ensureSuite())?.items;
  if (!pack) { console.error(`${MODULE_ID} | createItem: sde-items pack not found`); return null; }

  const itemData = buildItemData(draft);
  // Commit choke point: sanitize persisted HTML (review #1) — covers both
  // parser output and preview-edited descriptions.
  if (itemData.system?.description) {
    itemData.system.description = cleanImportHtml(itemData.system.description);
  }
  const index = await pack.getIndex();
  const existing = [...index].find((e) => (e.name ?? "").toLowerCase() === itemData.name.toLowerCase());

  const buildPayload = () => ({
    ...itemData,
    folder: folder ?? null,
    flags: {
      ...(itemData.flags ?? {}),
      [MODULE_ID]: { ...(itemData.flags?.[MODULE_ID] ?? {}), source, imported: true },
    },
  });

  if (existing) {
    const choice = onConflict ? await onConflict(itemData.name) : "rename";
    if (choice === "skip") return { name: itemData.name, status: "skipped" };
    if (choice === "replace") {
      const old = await pack.getDocument(existing._id).catch(() => null);
      if (old) {
        // Non-destructive replace: in-place update (UUID + inbound links
        // survive) with create-then-delete fallback — the original is never
        // deleted before the replacement exists.
        const { doc, mode } = await replaceDocument(old, buildPayload(), pack);
        return { uuid: doc.uuid, name: doc.name, status: "replaced", mode };
      }
      // Index entry without a resolvable document — fall through to create.
    } else {
      itemData.name = _uniqueName(index, itemData.name);
    }
  }

  const item = await Item.create(buildPayload(), { pack: pack.collection });
  return { uuid: item.uuid, name: item.name, status: "created" };
}

/**
 * The folder path a spell files under, mirroring the system spells pack:
 * Spells → <Class> → Tier N → <Alignment>. Blank segments drop out (an unclassed
 * spell → Spells → Tier N; an untagged one omits the alignment leaf).
 *
 * @param {string} className  resolved/parsed class name (e.g. "Wizard")
 * @param {number|string} tier
 * @param {string} [alignment]  lawful|chaotic|neutral ("" / "universal" → no leaf)
 * @returns {string[]}
 */
/** Wizard's alignment lists print under variant names — a neutral Wizard spell
 *  IS a Druid spell, lawful = Mage, chaotic = Sorcerer. Other casters label
 *  their alignment lists by the alignment itself (Priest (Lawful) …). */
const WIZARD_ALIGN_VARIANT = { neutral: "Druid", lawful: "Mage", chaotic: "Sorcerer" };

/**
 * Spell-pack folder path for a spell: a SINGLE level under "Spells" named
 * "<Class> (<Variant>)" — the variant is the Wizard list name
 * (Druid/Mage/Sorcerer) or, for other casters, the alignment
 * (Priest (Lawful)). A spell with no alignment folders under just "<Class>"
 * (e.g. Necromancer). Tier is intentionally NOT a folder level — the builder
 * groups spells by system.tier, and a Class→Tier→Alignment nest buried them
 * four folders deep. Layout matches the user's reference image (2026-07-12).
 * @param {string} className  e.g. "Wizard"
 * @param {number} [_tier]    accepted for signature compatibility; unused
 * @param {string} [alignment]  "" | lawful | neutral | chaotic | universal
 */
export function spellFolderNames(className, _tier, alignment = "") {
  const titleCase = (s) => String(s ?? "").replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const cls = String(className ?? "").trim();
  const clsTitle = cls ? titleCase(cls) : null;
  if (!clsTitle) return ["Spells"];
  const al = String(alignment ?? "").trim().toLowerCase();
  if (!al || al === "universal") return ["Spells", clsTitle];
  const variant = /^wizard$/i.test(cls) ? (WIZARD_ALIGN_VARIANT[al] ?? titleCase(al)) : titleCase(al);
  return ["Spells", `${clsTitle} (${variant})`];
}

/**
 * The talents pack folder a talent files under, mirroring the system Talents
 * pack's top-level grouping by `talentClass`: Ancestry / Class / Level /
 * Patron Boon. Unknown/blank talentClass → "Level" (the schema initial).
 * @param {string} talentClass  system.talentClass value (ancestry|class|level|patronBoon)
 * @returns {string[]}
 */
export function talentFolderNames(talentClass) {
  const map = { ancestry: "Ancestry", class: "Class", level: "Level", patronBoon: "Patron Boon" };
  return [map[String(talentClass ?? "").trim()] ?? "Level"];
}

/** The talents pack folder id a talent draft belongs in (by talentClass). */
async function talentFolderId(pack, draft) {
  // Mirror buildItemData's default so a talentClass-less draft folders where it
  // will actually be created ("level").
  return ensureFolderPath(pack, talentFolderNames(draft.talentClass ?? "level"));
}

/** The spell-pack folder id a spell draft belongs in (Spells → Class → Tier → Alignment). */
async function spellFolderId(pack, draft) {
  let className = draft.className ?? "";
  // Prefer the resolved class's canonical name over the raw parsed string.
  if (Array.isArray(draft.class) && draft.class[0]) {
    const c = await fromUuid(draft.class[0]).catch(() => null);
    if (c?.name) className = c.name;
  }
  return ensureFolderPath(pack, spellFolderNames(className, draft.tier, draft.alignment));
}

/**
 * Foundry item TYPE → the Character-Options suite pack it belongs in, so
 * char-builder content mirrors the system's per-type packs (and keeps
 * cross-pack @UUID links valid) instead of piling into sde-items. Anything not
 * listed (Weapon/Armor/Basic/Potion/Scroll/Wand/Gem/magic items…) stays in
 * sde-items — that's the loot/gear library. Ids match SUITE_PACKS.
 */
const TYPE_TO_PACK_ID = {
  Ancestry:   "ancestries",
  Talent:     "talents",
  Background: "background",
  Class:      "classes",
  Spell:      "spells",
  Deity:      "patrons-and-deities",
  Patron:     "patrons-and-deities",
  Language:   "languages",
};

/** Find-or-create the suite pack a draft type routes to (default sde-items). */
async function _packForType(type) {
  const id = TYPE_TO_PACK_ID[type] ?? "sde-items";
  const desc = SUITE_PACKS.find((d) => d.id === id);
  // Char-option packs (Talents, Classes, Spells, …) must land in the nested
  // "Character Options" sidebar folder. ensureSuite is the single place that
  // positions packs, so route through it (idempotent find-or-create) — a bare
  // ensurePack/findSuitePack would leave an existing pack in its old folder.
  if (desc?.charOption) {
    const suite = await ensureSuite();
    return suite?.[desc.key] ?? findSuitePack(id) ?? ensurePack(desc);
  }
  const existing = findSuitePack(id);
  if (existing) return existing;
  if (id === "sde-items" || !desc) return (await ensureSuite())?.items;
  return ensurePack(desc);
}

/**
 * Batch-import drafts, routing each to its type's suite pack (Ancestry →
 * world.ancestries, Talent → world.talents, Spell → world.spells, … ; loot/gear
 * stays in sde-items). Ensures each target pack + a per-source folder (spells
 * fold Spells → Class → Tier instead), creates each, then invalidates the
 * LootLinker cache so new items are findable immediately (A-06). GM-only.
 *
 * @param {object[]} drafts
 * @param {{ source?, onConflict? }} opts
 * @returns {Promise<{created:object[], replaced:object[], skipped:string[], total:number}|null>}
 */
export async function createItems(drafts, { source = "", onConflict } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import items."); return null; }

  // Group by target pack so each pack's source folder + index are set up once.
  const byPack = new Map();   // packId → drafts[]
  for (const d of drafts) {
    const id = TYPE_TO_PACK_ID[d.type] ?? "sde-items";
    (byPack.get(id) ?? byPack.set(id, []).get(id)).push(d);
  }

  const out = { created: [], replaced: [], skipped: [], total: drafts.length };
  for (const [packId, group] of byPack) {
    const pack = await _packForType(group[0].type);
    if (!pack) { console.error(`${MODULE_ID} | createItems: pack for "${packId}" not found`); continue; }
    if (pack.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }

    // Source folder used only for items that fold neither by class/tier (spells)
    // nor by talentClass (talents) — i.e. gear, classes, backgrounds, ancestries.
    const needsSourceFolder = group.some((d) => d.type !== "Spell" && d.type !== "Talent");
    const sourceFolder = needsSourceFolder ? await ensureSourceFolder(pack, source) : null;

    for (const draft of group) {
      let folder;
      if (draft.type === "Spell") folder = await spellFolderId(pack, draft);
      else if (draft.type === "Talent") folder = await talentFolderId(pack, draft);
      else folder = sourceFolder;
      const r = await createItem(draft, { pack, folder, source, onConflict });
      if (!r) continue;
      if (r.status === "skipped") out.skipped.push(r.name);
      else if (r.status === "replaced") out.replaced.push({ name: r.name, uuid: r.uuid });
      else out.created.push({ name: r.name, uuid: r.uuid });
    }
  }

  LootLinker.invalidate();
  return out;
}

export const ItemImporter = { buildItemData, createItem, createItems, spellFolderNames, talentFolderNames };
