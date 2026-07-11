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
import { findSuitePack, ensureSuite, ensureSourceFolder, ensureFolderPath, replaceDocument, cleanImportHtml } from "./compendium-suite.mjs";
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
      flags: { [MODULE_ID]: { imported: true } },
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
        talentClass: "level",
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
        talents: [],
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
 * Spells → <Class> → Tier N. Blank class/tier segments drop out (an unclassed
 * spell → Spells → Tier N; a tierless one → Spells → <Class>).
 *
 * @param {string} className  resolved/parsed class name (e.g. "Wizard")
 * @param {number|string} tier
 * @returns {string[]}
 */
export function spellFolderNames(className, tier) {
  const tierNum = Number(tier);
  const tierLabel = Number.isFinite(tierNum) && tierNum > 0 ? `Tier ${tierNum}` : null;
  const cls = String(className ?? "").trim();
  const clsTitle = cls ? cls.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : null;
  return ["Spells", clsTitle, tierLabel].filter(Boolean);
}

/** The sde-items folder id a spell draft belongs in (Spells → Class → Tier). */
async function spellFolderId(pack, draft) {
  let className = draft.className ?? "";
  // Prefer the resolved class's canonical name over the raw parsed string.
  if (Array.isArray(draft.class) && draft.class[0]) {
    const c = await fromUuid(draft.class[0]).catch(() => null);
    if (c?.name) className = c.name;
  }
  return ensureFolderPath(pack, spellFolderNames(className, draft.tier));
}

/**
 * Batch-import drafts under one source. Ensures the sde-items pack + source
 * folder, creates each, then invalidates the LootLinker cache so the new items
 * are findable immediately (A-06). Spells are filed under Spells → Class → Tier
 * (mirroring the system pack) instead of the flat source folder. GM-only.
 *
 * @param {object[]} drafts
 * @param {{ source?, onConflict? }} opts
 * @returns {Promise<{pack:string, created:object[], replaced:object[], skipped:string[], total:number}|null>}
 */
export async function createItems(drafts, { source = "", onConflict } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import items."); return null; }
  const pack = findSuitePack("sde-items") ?? (await ensureSuite())?.items;
  if (!pack) { console.error(`${MODULE_ID} | createItems: sde-items pack not found`); return null; }

  if (pack.locked) {
    try { await pack.configure({ locked: false }); } catch (_) {}
  }

  // Source folder only used for non-spell items; spells fold by class/tier.
  const hasNonSpell = drafts.some((d) => d.type !== "Spell");
  const sourceFolder = hasNonSpell ? await ensureSourceFolder(pack, source) : null;
  const out = { pack: pack.collection, created: [], replaced: [], skipped: [], total: drafts.length };

  for (const draft of drafts) {
    const folder = draft.type === "Spell" ? await spellFolderId(pack, draft) : sourceFolder;
    const r = await createItem(draft, { pack, folder, source, onConflict });
    if (!r) continue;
    if (r.status === "skipped") out.skipped.push(r.name);
    else if (r.status === "replaced") out.replaced.push({ name: r.name, uuid: r.uuid });
    else out.created.push({ name: r.name, uuid: r.uuid });
  }

  LootLinker.invalidate();
  return out;
}

export const ItemImporter = { buildItemData, createItem, createItems, spellFolderNames };
