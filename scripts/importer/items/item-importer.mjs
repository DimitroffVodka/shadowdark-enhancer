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
 *   relinkSpellsToClasses()            — Foundry-bound spell↔class retro-link sweep
 *   ItemImporter = { buildItemData, createItem, createItems }
 */
import { MODULE_ID } from "../../shared/module-id.mjs";
import { pickTreasureIcon } from "../../loot/loot-pack.mjs";
import { pickShikashiSpellIcon } from "./shikashi-icons.mjs";
import { findSuitePack, ensureSuite, ensurePack, ensureSourceFolder, ensureFolderPath, replaceDocument, cleanImportHtml, SUITE_PACKS } from "../../shared/compendium-suite.mjs";
import { LootLinker } from "../../loot/loot-linker.mjs";

// ─── Pure construction choke point (A-03) ────────────────────────────────────

/**
 * Convert a parser draft into a system-faithful Shadowdark Item creation payload.
 * This is THE single item-construction choke point (A-03).
 *
 * Routing:
 *   Magic items (draft.riders present with at least one rider keyword):
 *     → type: ({weapon:"Weapon",armor:"Armor"})[lc] ?? "Basic"  (magic-forge mapping)
 *     → description: already HTML (D4 — item-parser guarantees this)
 *     → flags[MODULE_ID].imported: true
 *
 *   Armor / Weapon (draft.type or name says so):
 *     → real stat shape (ac{}/damage{}/range/type) + resolved properties[]
 *
 *   Plain gear (no riders, or empty riders):
 *     → type: "Basic" (or the draft's forced subtype)
 *     → cost from draft.cost, slots from draft.slots
 *     → img: draft.img ?? pickTreasureIcon(draft.name)  (A-03 icon reuse)
 *     → system.treasure: false  (only true when draft.treasure opts in — this
 *       path imports GEAR, not loot; the treasure roller builds its own items)
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
        [MODULE_ID]: {
          imported: true,
          // Parsed caster-class NAME. system.class above only fills when the
          // class already exists at commit time (resolveSpellClass); this keeps
          // the intent on the doc so relinkSpellsToClasses() can link the spell
          // when the class is imported later — either import order works.
          ...(String(draft.className ?? "").trim()
            ? { spellClassName: String(draft.className).trim() } : {}),
        },
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

  // Honor the Shadowdark gear TYPE the draft carries — the hub's item-type
  // selector stamps it (draft.type = "Potion"/"Scroll"/…), and the parser
  // infers it from the name — instead of collapsing every item to Basic. A
  // magic item with no explicit weapon/armor type still maps to Weapon/Armor
  // when its name says so, else Basic. Unknown types fall back to Basic.
  const GEAR_TYPES = new Set(["Basic", "Weapon", "Armor", "Potion", "Scroll", "Wand", "Gem"]);
  const lc = String(draft.type ?? "").toLowerCase();
  const sdType = GEAR_TYPES.has(draft.type)
    ? draft.type
    : (hasMagicRiders ? ({ weapon: "Weapon", armor: "Armor" })[lc] ?? "Basic" : "Basic");

  // Shared PhysicalItemSD fields (cost/slots/quantity) every gear type carries.
  const physical = {
    description: draft.description ?? "<p></p>",
    cost:   { gp: draft.cost?.gp ?? 0, sp: draft.cost?.sp ?? 0, cp: draft.cost?.cp ?? 0 },
    slots:  {
      free_carry: draft.slots?.free_carry ?? 0,
      per_slot:   draft.slots?.per_slot   ?? 1,
      slots_used: draft.slots?.slots_used ?? 1,
    },
    quantity: 1,
    // Armor/Weapon carry properties as an array of Property-item UUIDs; the gear
    // parser + resolver stamp them on the draft. Empty for plain gear.
    ...(Array.isArray(draft.properties) ? { properties: draft.properties } : {}),
    ...(draft.magicItem ? { magicItem: true } : {}),
    ...(draft.source?.title ? { source: { title: draft.source.title } } : {}),
  };

  // ── Armor — real stat shape (ArmorSD). ac.base is the absolute AC of worn
  // armor (11/13/15); shields use base 0 + a modifier the actor stacks as bonus
  // AC (PlayerSD keys off ac.base===0). attribute is the AC bonus attribute
  // ("dex"), blank for shields. baseArmor references a base-armor slug. ──
  if (sdType === "Armor") {
    const ac = draft.ac ?? {};
    return {
      name, type: "Armor", img,
      system: {
        ...physical,
        ac: {
          attribute: ac.attribute ?? (ac.base ? "dex" : ""),
          base:      Number(ac.base) || 0,
          modifier:  Number(ac.modifier) || 0,
        },
        baseArmor: draft.baseArmor ?? "",
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }

  // ── Weapon — real stat shape (WeaponSD). damage.oneHanded / twoHanded hold
  // die keys ("d8"); a versatile weapon fills both, a two-handed-only weapon
  // (crossbow) fills only twoHanded. type is melee|ranged, range close|near|far.
  // handedness is derived by the model from properties/damage, so we omit it. ──
  if (sdType === "Weapon") {
    const dmg = draft.damage ?? {};
    return {
      name, type: "Weapon", img,
      system: {
        ...physical,
        damage: { oneHanded: dmg.oneHanded ?? "", twoHanded: dmg.twoHanded ?? "" },
        range:  draft.range || "close",
        type:   draft.wtype || "melee",
        baseWeapon: draft.baseWeapon ?? "",
        ammoClass:  draft.ammoClass ?? "",
      },
      flags: { [MODULE_ID]: { imported: true } },
    };
  }

  // ── Basic / Potion / Scroll / Wand / Gem — plain gear. `treasure` is a
  // Basic-only field (the DataModel drops it on other types). It marks
  // valuables/loot, NOT ordinary gear, so it defaults false and is only set
  // when a draft explicitly opts in (the loot-pack treasure path builds its own
  // itemData directly and never routes through here). ──
  return {
    name,
    type: sdType,
    img,
    system: {
      ...physical,
      ...(sdType === "Basic" ? { treasure: !!draft.treasure } : {}),
    },
    flags: { [MODULE_ID]: { imported: true } },
  };
}

// ─── Gear property resolver (Foundry-bound) ──────────────────────────────────

/**
 * Cache of Shadowdark property NAME → UUID, keyed `${itemType}:${nameLower}`
 * (itemType is "armor" | "weapon"). Some names — "Sundering" — exist for BOTH
 * types as separate docs, so the key must include the type. Session-scoped;
 * the pack doesn't change under a running world.
 */
let _propertyIndexCache = null;

async function _propertyIndex() {
  if (_propertyIndexCache) return _propertyIndexCache;
  const map = new Map();
  const pack = game.packs?.get("shadowdark.properties");
  if (pack) {
    // Only ~18 docs — load them fully so system.itemType is reliable rather than
    // relying on index field projection.
    for (const doc of await pack.getDocuments()) {
      const itemType = doc.system?.itemType ?? "armor";
      map.set(`${itemType}:${(doc.name ?? "").toLowerCase()}`, doc.uuid);
    }
  }
  _propertyIndexCache = map;
  return map;
}

/**
 * Resolve a gear item's `draft.propNames` (Shadowdark property names emitted by
 * gear-parser) into the DocumentUUID array the Armor/Weapon data models store
 * in `system.properties`. Type-filtered so armor "Sundering" and weapon
 * "Sundering" resolve to their own docs. Mutates the passed `{ draft, warnings }`
 * in place: sets `draft.properties` (UUIDs) and appends a review warning for any
 * name that can't be resolved. No-op for non-gear drafts. GM-independent (index
 * read), but only meaningful in a live world.
 *
 * @param {{ draft: object, warnings?: string[] }} item
 * @returns {Promise<{ draft: object, warnings: string[] }>}
 */
export async function resolveGearProperties(item) {
  const draft = item?.draft ?? item;
  if (!draft || (draft.type !== "Armor" && draft.type !== "Weapon")) return item;
  const names = Array.isArray(draft.propNames) ? draft.propNames : [];
  const warnings = item.warnings ?? (item.warnings = []);
  const map = await _propertyIndex();
  const itemType = draft.type === "Weapon" ? "weapon" : "armor";
  const uuids = [];
  for (const nm of names) {
    const key = String(nm).toLowerCase();
    const uuid = map.get(`${itemType}:${key}`)
      ?? map.get(`weapon:${key}`) ?? map.get(`armor:${key}`);   // cross-type fallback
    if (uuid) uuids.push(uuid);
    else warnings.push(`Property "${nm}" not found in shadowdark.properties — left off; add it on the sheet.`);
  }
  draft.properties = uuids;
  return item;
}

/** Resolve properties for a batch of gear items (see resolveGearProperties). */
export async function resolveGearPropertiesAll(items) {
  for (const it of items ?? []) await resolveGearProperties(it);
  return items;
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
 * Inverse of spellFolderNames' leaf: "<Class> (Variant)" → "<Class>".
 * Fallback class-name signal for spells imported before the
 * flags[MODULE_ID].spellClassName stamp existed. Pure, node-testable.
 * @param {string} folderName  e.g. "Wizard (Druid)", "Priest (Lawful)", "Necromancer"
 * @returns {string} class name, "" when the folder carries none
 */
export function classNameFromSpellFolder(folderName) {
  return String(folderName ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
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
  if (out.created.length || out.replaced.length) {
    // Treasure/encounter tables that referenced these items by bare name pick
    // up real links via the debounced sweep — no manual Re-link needed.
    const { TableEnricher } = await import("../tables/table-enrich.mjs");
    TableEnricher.scheduleRelinkSweep();
    // Fresh spells may belong to a Wizard-variant borrower's list (Green Knight
    // casts the neutral Druid list) whose class already imported — stamp its
    // uuid on so the level-up spellbook offers that list. Import-order
    // independent (also fires from createClassUnit + GM ready); silent otherwise.
    if (drafts.some((d) => d.type === "Spell")) {
      try {
        const { tagBorrowedSpellLists } = await import("../char-content/class-unit-importer.mjs");
        const tagged = await tagBorrowedSpellLists();
        if (tagged) ui.notifications?.info(`Tagged ${tagged} spell(s) to a borrowed-list class.`);
      } catch (err) {
        console.error(`${MODULE_ID} | tagBorrowedSpellLists after spell import failed:`, err);
      }
    }
  }
  return out;
}

/**
 * Link suite spells to their caster class — the retro half of "spells and
 * classes import in either order". resolveSpellClass links a spell at commit
 * time when its class already exists; this sweep covers the opposite order:
 * any world.spells Spell with NO live class ref whose intended class NOW
 * resolves gets linked. Intent = flags[MODULE_ID].spellClassName (stamped at
 * creation) or, for spells imported before that stamp existed, the
 * "Spells / <Class> (Variant)" pack folder name. Resolution goes through
 * ClassIndex so priority matches commit-time linking (system packs first);
 * a spell with a live class link is never touched (borrowed lists link
 * elsewhere on purpose). Idempotent and silent — callers notify on > 0.
 *
 * Fires automatically from createClassUnit (a class just appeared) and once
 * per GM ready (self-heals worlds that imported spells before their class).
 *
 * The Foundry touch points are injectable so the persistence logic is
 * node-testable without a live world (defaults hit the real pack / ClassIndex /
 * Item / Hooks). The LIVE semantics are unchanged.
 *
 * @param {object} [deps]
 * @param {object}   [deps.pack]            spells pack (default findSuitePack("spells"))
 * @param {Function} [deps.resolveByName]   async name → { uuid } (default ClassIndex)
 * @param {Function} [deps.resolveUuid]     async uuid → doc|null (default fromUuid)
 * @param {Function} [deps.updateDocuments] async (updates, opts) → void (default Item.updateDocuments)
 * @param {Function} [deps.callHook]        (name) → void (default Hooks.callAll)
 * @returns {Promise<number>} spells updated
 */
export async function relinkSpellsToClasses(deps = {}) {
  const pack = deps.pack ?? findSuitePack("spells");
  if (!pack) return 0;
  const resolveByName = deps.resolveByName
    ?? (async (name) => (await import("../char-content/class-index.mjs")).ClassIndex.resolveByName(name));
  const resolveUuid = deps.resolveUuid ?? ((u) => fromUuid(u).catch(() => null));
  const updateDocuments = deps.updateDocuments ?? ((updates, opts) => Item.updateDocuments(updates, opts));
  const callHook = deps.callHook ?? ((name) => Hooks.callAll(name));

  const index = await pack.getIndex({ fields: ["type", "system.class", "folder", `flags.${MODULE_ID}.spellClassName`] });
  const updates = [];
  for (const entry of index) {
    if (entry.type !== "Spell") continue;
    const raw = entry.system?.class;
    const cur = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    let live = false;
    for (const u of cur) {
       
      if (await resolveUuid(u)) { live = true; break; }
    }
    if (live) continue;   // already linked where it belongs (borrowed/multi-class kept)
    const folderName = pack.folders.get(entry.folder)?.name ?? "";
    // Intent flag wins over the folder-name fallback (folder-only = a spell
    // imported before the stamp existed).
    const want = String(entry.flags?.[MODULE_ID]?.spellClassName ?? "").trim()
      || classNameFromSpellFolder(folderName);
    if (!want) continue;
     
    const hit = await resolveByName(want);
    if (!hit?.uuid) continue;   // class still absent — a later import links it
    updates.push({ _id: entry._id, "system.class": [hit.uuid] });
  }
  if (!updates.length) return 0;
  if (pack.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }
  await updateDocuments(updates, { pack: pack.collection });
  console.log(`${MODULE_ID} | relinkSpellsToClasses: linked ${updates.length} spell(s) to their caster class`);
  // Open char-builder / hub instances drop caches + re-render (gap→have flips).
  callHook(`${MODULE_ID}.contentUnlocked`);
  return updates.length;
}

/** The Shadowdark SYSTEM item packs whose contents ship with the game — an
 *  import that names one of these would only duplicate core content. Weapons
 *  and armor both live in `gear` (no separate packs). */
const SYSTEM_ITEM_PACKS = ["shadowdark.gear", "shadowdark.magic-items"];

/**
 * Normalize an item name for system-duplicate matching: drop parenthetical
 * quantities ("Arrows (20)", "Caltrops (One Bag)"), fold case and punctuation.
 * Deliberately does NOT strip trailing comma clauses — "Rope, 60'" must stay
 * distinct from "Rope, Morzo Silk", and "Flask or bottle" from "Flask".
 * @param {string} s
 * @returns {string}
 */
export function normalizeItemName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")     // "(20)", "(One Bag)"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Build a lookup of every item that already ships in the Shadowdark SYSTEM
 * compendium (gear + magic-items), keyed by normalized name. Reads the pack
 * indexes only (no full document load). Returns an empty Map when the system
 * isn't Shadowdark or the packs are absent, so callers degrade to "import
 * everything".
 * @returns {Promise<Map<string, {name: string, pack: string}>>}
 */
export async function systemItemNameIndex() {
  const index = new Map();
  for (const key of SYSTEM_ITEM_PACKS) {
    const pack = game.packs?.get(key);
    if (!pack) continue;
    const idx = pack.indexed ? pack.index : await pack.getIndex();
    for (const e of idx) {
      const k = normalizeItemName(e.name);
      if (k && !index.has(k)) index.set(k, { name: e.name, pack: key });
    }
  }
  return index;
}

/**
 * Split parsed item drafts into those genuinely new to this world's Shadowdark
 * system and those the system already ships (so the importer doesn't duplicate
 * core gear/weapons/armor/magic items). Match is by normalized name against the
 * live system pack indexes.
 * @param {{draft: object}[]} items  parsed `{draft, warnings}` entries
 * @returns {Promise<{fresh: object[], duplicates: {name: string, reason: string}[]}>}
 */
export async function partitionSystemDuplicates(items) {
  const sys = await systemItemNameIndex();
  if (!sys.size) return { fresh: items, duplicates: [] };
  const fresh = [];
  const duplicates = [];
  for (const it of items) {
    const hit = sys.get(normalizeItemName(it?.draft?.name));
    if (hit) duplicates.push({ name: it.draft.name, reason: `already in ${hit.pack} (system content) — not re-imported` });
    else fresh.push(it);
  }
  return { fresh, duplicates };
}

export const ItemImporter = { buildItemData, createItem, createItems, relinkSpellsToClasses, spellFolderNames, talentFolderNames, systemItemNameIndex, partitionSystemDuplicates, normalizeItemName, resolveGearProperties, resolveGearPropertiesAll };
