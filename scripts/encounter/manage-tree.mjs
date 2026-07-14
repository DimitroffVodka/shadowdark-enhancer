/**
 * Shadowdark Enhancer — Manage-tree composition layer.
 *
 * Builds the nested folder/sub-folder tree rendered by the importer hub's
 * "Manage" strip. Pure data: it composes the three existing live censuses
 * (character content, monsters, items) into one tree of nodes, each reporting
 * how much content is UNLOCKED (present in this world / the sde-* packs) vs
 * LOCKED (known content not yet imported). No storage is changed.
 *
 * Node shape (consumed by templates/partials/tree-node.hbs):
 *   { id, label, icon, have, locked, children:[node], entries:[entry], placeholder?, note? }
 * where entry = { name, seedAction, type, src, pages } — the same data-attrs the
 * existing Unlock/seed handlers already read (charSeedPaste / monsterSeedPaste /
 * itemSeedPaste), so wiring is unchanged.
 *
 * Tree structure:
 *   Character Content → Ancestries · Backgrounds · Classes(→per-class→{Class Abilities, Talents}, Multi) · Patrons & Deities
 *   Spells            → per source (CS4 / CS5 / CS6 / Western Reaches)
 *   Gameplay          → per source — mechanics tables (carousing, enduring wounds,
 *                       traps & hazards, boons, casting mishaps)
 *   Roll Tables       → per source — the remaining manifest Table entries
 *                       (generators, encounters, treasure, names)
 *   Monsters          → CS1…CS6 · Western Reaches (fixed skeleton) + any other present source
 *   Items             → Basic Gear · Armor · Weapons · Magic Items (Potion+Scroll+Wand)
 *
 * Table routing: ANCESTRY_TABLES → Ancestries; BACKGROUND_TABLES → Backgrounds;
 * PATRON_TABLES → Patrons & Deities; GAMEPLAY_TABLES → Gameplay; everything
 * else → Roll Tables.
 */
import {
  gatherPresence, gatherCharContentEntries, hasTable, nameVariants,
  MANIFEST_CLASSES, CHAR_SOURCES, ANCESTRY_TABLES, BACKGROUND_TABLES,
  SPELL_LISTS, gatherSpellListCensus,
} from "./char-content-manifest.mjs";
import { coreGroupsFor } from "./core-table-groups.mjs";
import { contentIdForName } from "./table-shapes.mjs";
import { GAMEPLAY_TABLES, PATRON_TABLES } from "./table-folders.mjs";
import { gatherCensus, liveActorRecords } from "./monster-census-live.mjs";
import { liveItemRecords } from "./item-census-live.mjs";
import { sourceFolderName } from "./compendium-suite.mjs";

const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Fixed monster-source skeleton so empty sources still render (0 locked). */
const MONSTER_SOURCES = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

// GAMEPLAY_TABLES / PATRON_TABLES routing sets now live in table-folders.mjs
// (single source of truth shared with the pack-folder resolver) — imported above.

/**
 * Published bestiary sizes (source label → monster count). The monster census
 * is reference-driven, so a fresh world may have no named gaps. These totals
 * keep each source discoverable as a direct paste/import action.
 */
const BESTIARY_COUNTS = { CS1: 14, CS2: 14, CS3: 12, CS4: 19, CS5: 5 };

/** Sort a leaf's entries: importable (locked) first, then imported, alpha within. */
function sortEntries(entries, alpha = false) {
  return entries.slice().sort((a, b) =>
    alpha
      ? a.name.localeCompare(b.name)
      : (Number(a.present) - Number(b.present)) || a.name.localeCompare(b.name));
}

/**
 * Leaf node that enumerates its FULL contents from presence-tagged records
 * (`{ name, present, type?, src?, pages? }`): imported entries render as
 * "in library", not-present entries carry an Unlock button (`seedAction`).
 * `have` = imported count; `locked` = importable count.
 */
function leaf(id, label, icon, records, seedAction, alpha = false) {
  const entries = sortEntries(records.map((r) => ({
    name: r.name,
    present: !!r.present,
    seedAction,
    type: r.type ?? "",
    src: r.src ?? "",
    pages: r.pages ?? "",
    // Stamp the persistent shape id on every shaped entry (prayers, boons,
    // gameplay tables), not just the Core leaf — source-scoped (Codex #1).
    contentId: contentIdForName(r.name, r.src) ?? undefined,
  })), alpha);
  const have = entries.filter((e) => e.present).length;
  return { id, label, icon, have, locked: entries.length - have, entries, children: [] };
}

/** Branch node summing its children's have/locked totals. */
function branch(id, label, icon, children, extra = {}) {
  const kids = children.filter(Boolean);
  return {
    id, label, icon,
    have: kids.reduce((a, k) => a + k.have, 0),
    locked: kids.reduce((a, k) => a + k.locked, 0),
    entries: [],
    children: kids,
    ...extra,
  };
}

/** Character Content branch (Ancestries / Backgrounds / Classes / Patrons). */
function buildCharContent(charEntries) {
  const ofType = (t) => charEntries.filter((e) => e.type === t);

  // Ancestries: a branch with three sub-folders so the ~17 tables don't sit in
  // one flat wall — the Ancestry items, the Names tables, and the Trinket
  // tables (user request). Every other Table entry (carousing, encounters,
  // boons, prayers…) lives in the top-level Roll Tables branch, not here.
  const ancestryTableNames = new Set(ANCESTRY_TABLES.map((t) => _norm(t.name)));
  const ancestryItemRecs = charEntries.filter((e) => e.type === "Ancestry");
  const nameTableRecs = charEntries.filter((e) => e.type === "Table"
    && ancestryTableNames.has(_norm(e.name)) && /\bnames$/i.test(e.name));
  const trinketTableRecs = charEntries.filter((e) => e.type === "Table"
    && ancestryTableNames.has(_norm(e.name)) && /\btrinket$/i.test(e.name));
  const ancestries = branch("char/ancestries", "Ancestries", "fa-people-group", [
    leaf("char/ancestries/kinds", "Ancestries", "fa-people-group", ancestryItemRecs, "charSeedPaste", true),
    leaf("char/ancestries/names", "Names", "fa-signature", nameTableRecs, "charSeedPaste", true),
    leaf("char/ancestries/trinkets", "Trinkets", "fa-gem", trinketTableRecs, "charSeedPaste", true),
  ]);

  // Backgrounds: the per-book d100 background roll tables only (one row each).
  // The individual Background items still exist (the char-builder lists them for
  // picking) and are imported by the table's bundle-unlock — they're just not
  // enumerated here, keeping this to one entry per roll table.
  const backgroundRecords = charEntries.filter((e) =>
    e.type === "Table" && BACKGROUND_TABLES.has(_norm(e.name)));
  const backgrounds = leaf("char/backgrounds", "Backgrounds", "fa-scroll", backgroundRecords, "charSeedPaste");

  // Classes: one Unlock row per class, alphabetical. Unlocking a class is a
  // BUNDLE — it brings that class's talents, talent table, abilities and spells
  // together, so individual talents/abilities aren't separately unlockable and
  // aren't enumerated here. A class printed in two books (Delver, Duelist,
  // Wyrdling) prefers the Western Reaches entry (WR is the char-builder's
  // canonical source; the deep-link opens the WR PDF) and shows the
  // Cursed-Scroll page as an "or …" alternate.
  const classEntries = [...MANIFEST_CLASSES].sort((a, b) => a.localeCompare(b)).map((cls) => {
    const recs = ofType("Class").filter((e) => e.name === cls);
    const primary = recs.find((e) => e.src === "WR") ?? recs.find((e) => e.pages) ?? recs[0];
    const alt = recs.find((e) => e !== primary && e.pages);
    return {
      name: cls, present: !!primary?.present, seedAction: "charSeedPaste",
      type: "Class", src: primary?.src ?? "", pages: primary?.pages ?? "",
      pagesAlt: alt ? `${alt.src} pg ${alt.pages}` : "",
    };
  });
  const classes = {
    id: "char/classes", label: "Classes", icon: "fa-users-rectangle",
    entries: classEntries, children: [],
    have: classEntries.filter((e) => e.present).length,
    locked: classEntries.filter((e) => !e.present).length,
  };

  // Patrons & Deities: a branch split into Boons and Prayers. The six
  // "Patron Boons: X" entries ship in the core Shadowdark system already, so
  // they're dropped from the importer list entirely (user request) — only the
  // WR "<God> Boons" tables and the god prayer generators remain.
  const patronRecords = charEntries.filter((e) =>
    e.type === "Table" && PATRON_TABLES.has(_norm(e.name)) && !/^patron boons:/i.test(e.name));
  const boonRecs = patronRecords.filter((e) => /\bboons$/i.test(e.name));
  const prayerRecs = patronRecords.filter((e) => /\bprayers$/i.test(e.name));
  const otherPatron = patronRecords.filter((e) => !/\b(boons|prayers)$/i.test(e.name));
  const patrons = branch("char/patrons", "Patrons & Deities", "fa-hands-praying", [
    leaf("char/patrons/boons", "Boons", "fa-gift", [...boonRecs, ...otherPatron], "charSeedPaste", true),
    leaf("char/patrons/prayers", "Prayers", "fa-hands-praying", prayerRecs, "charSeedPaste", true),
  ]);

  return branch("char", "Character Content", "fa-user-plus", [ancestries, backgrounds, classes, patrons]);
}

/**
 * Spells top-level branch, sub-grouped by source and — the part that matters —
 * by CASTER LIST, not a flat spell dump. Each source lists its alignment/class
 * lists (Druid=Wizard·Neutral, Sorcerer=Wizard·Chaotic, Mage=Wizard·Lawful, the
 * WR Priest lists by alignment, Necromancer) as a single BULK-IMPORT row: one
 * "Import list" button that opens the Spell Importer preset to that list's
 * class + alignment + source and deep-links the PDF, so the GM pastes the whole
 * section once instead of importing 16 spells one at a time. Presence is the
 * live tag census (source slug + alignment flag + class link), so a list flips
 * to "imported" once its spells carry the right tags. `spellListCensus` is
 * Map<listKey,{present,count}>.
 */
function buildSpells(spellListCensus) {
  // The three Wizard-alignment lists (Druid·Neutral, Mage·Lawful,
  // Sorcerer·Chaotic) are the SAME spells in the Cursed Scrolls and in Western
  // Reaches, and the census is source-independent — so show ONE row each,
  // sourced from WR (the char-builder's canonical book). Drop the CS twins so
  // the user doesn't see (and can't accidentally double-import) the duplicate.
  const wizardTwin = (l) => l.casterClass === "Wizard" && l.source !== "WR"
    && SPELL_LISTS.some((o) => o.source === "WR" && o.short === l.short);
  const lists = SPELL_LISTS.filter((l) => !wizardTwin(l));
  const bySrc = new Map();
  for (const l of lists) {
    if (!bySrc.has(l.source)) bySrc.set(l.source, []);
    bySrc.get(l.source).push(l);
  }
  const sources = [...bySrc.keys()]
    .sort((a, b) => (CHAR_SOURCES[a]?.label ?? a).localeCompare(CHAR_SOURCES[b]?.label ?? b));
  const children = sources.map((src) => {
    const entries = bySrc.get(src).map((l) => {
      const c = spellListCensus.get(l.key) ?? { present: false, count: 0 };
      const shared = l.casterClass === "Wizard";   // Druid/Mage/Sorcerer cover CS + WR
      return {
        name: l.short ?? l.label,
        present: c.present,
        seedAction: "spellListSeed",
        type: "SpellList",
        src: l.source,
        pages: l.page,
        listKey: l.key,
        importLabel: "Import list",
        countNote: c.count ? `${c.count} imported${shared ? " · covers CS + WR" : ""}` : (shared ? "covers CS + WR" : ""),
      };
    });
    const have = entries.filter((e) => e.present).length;
    return {
      id: `spells/${src}`, label: CHAR_SOURCES[src]?.label ?? src, icon: "fa-wand-sparkles",
      entries, children: [], have, locked: entries.length - have,
    };
  });
  return branch("spells", "Spells", "fa-book-sparkles", children);
}

/**
 * A Core Rulebook table group as a leaf: its member tables are enumerated from
 * CORE_TABLE_GROUPS under the section header. Each sub-table is independently
 * importable and present-checked by its
 * own name (a paste imports one named table; there is no atomic bundle). A
 * table imported as "Source - Name" satisfies the bare "Name" probe via
 * hasTable's suffix match, so a sub-table flips to "imported" the moment its
 * own table exists — no rep-probe indirection, no "in bundle" rows.
 */
function coreGroupLeaf(g, tablesPresent) {
  const entries = g.tables.map((t) => {
    const present = hasTable(tablesPresent, t.name);
    return {
      name: t.name, present, seedAction: "charSeedPaste",
      type: "Table", src: "CORE", pages: String(t.page),
      contentId: contentIdForName(t.name, "CORE") ?? undefined,
    };
  });
  const have = entries.filter((e) => e.present).length;
  return {
    id: `core/${g.section}/${g.key}`, label: g.header, icon: g.icon,
    entries, children: [],
    have, locked: entries.length - have,
  };
}

/**
 * The "Core Rulebook" node for a Manage section ('rolltables' | 'gameplay'):
 * a branch of per-group leaves; each leaf lists its sub-tables, each of which
 * is unlocked and present-checked independently (see coreGroupLeaf).
 */
function buildCoreRulebook(section, tablesPresent) {
  const children = coreGroupsFor(section).map((g) => coreGroupLeaf(g, tablesPresent));
  return branch(`${section}/CORE`, CHAR_SOURCES.CORE.label, "fa-book", children);
}

/**
 * Roll Tables top-level branch, sub-grouped by source. Carries every manifest
 * Table entry EXCEPT the WR ancestry Names/Trinkets (those stay under
 * Character Content → Ancestries). Non-Core sources render a flat leaf; the
 * Core Rulebook renders per-bundle sub-branches enumerating every table (see
 * buildCoreRulebook). Unlock rows seed the same charSeedPaste flow.
 */
function buildRollTables(charEntries, tablesPresent) {
  const ancestryTableNames = new Set(ANCESTRY_TABLES.map((t) => _norm(t.name)));
  const tableRecs = charEntries.filter((e) =>
    e.type === "Table" && !ancestryTableNames.has(_norm(e.name))
    && !GAMEPLAY_TABLES.has(_norm(e.name)) && !PATRON_TABLES.has(_norm(e.name))
    && !BACKGROUND_TABLES.has(_norm(e.name)));
  const sources = [...new Set(tableRecs.map((r) => r.src))];
  const children = sources.map((src) =>
    src === "CORE"
      ? buildCoreRulebook("rolltables", tablesPresent)
      : leaf(`tables/${src}`, CHAR_SOURCES[src]?.label ?? src, "fa-dice",
          tableRecs.filter((r) => r.src === src), "charSeedPaste"));
  return branch("tables", "Roll Tables", "fa-table-list", children);
}

/**
 * Gameplay top-level branch, sub-grouped by source — the books' Gameplay-chapter
 * mechanics tables (carousing, enduring wounds, traps & hazards, boons, casting
 * mishaps). Same entry shape/flow as Roll Tables; membership = GAMEPLAY_TABLES.
 */
function buildGameplay(charEntries, tablesPresent) {
  const recs = charEntries.filter((e) =>
    e.type === "Table" && GAMEPLAY_TABLES.has(_norm(e.name)));
  const sources = [...new Set(recs.map((r) => r.src))];
  const children = sources.map((src) =>
    src === "CORE"
      ? buildCoreRulebook("gameplay", tablesPresent)
      : leaf(`gameplay/${src}`, CHAR_SOURCES[src]?.label ?? src, "fa-chess-knight",
          recs.filter((r) => r.src === src), "charSeedPaste"));
  return branch("gameplay", "Gameplay", "fa-dice-d20", children);
}

/**
 * Monsters top-level branch. Each source leaf enumerates already-imported
 * monsters (from sde-actors) plus importable gap names (referenced by pack
 * tables but not resolvable). Fixed CS1–6 + WR skeleton, then any other source.
 */
function buildMonsters(monsterRows, actorRecords) {
  // Imported monster names grouped by display source label (deduped).
  const presentByLabel = new Map();
  for (const r of actorRecords) {
    const label = sourceFolderName(r.source ?? "");
    if (!presentByLabel.has(label)) presentByLabel.set(label, new Map());
    presentByLabel.get(label).set(_norm(r.name), r.name);
  }
  const rowByLabel = new Map(monsterRows.map((r) => [r.label, r]));

  const makeLeaf = (label) => {
    // Stamp each entry's source (the leaf label) so the seed carries the book —
    // monster gaps have no page cite, but knowing the source lets the import
    // folder + the "Grab from PDF" page-range extractor default to the right book.
    const present = [...(presentByLabel.get(label)?.values() ?? [])].map((name) => ({ name, present: true, src: label }));
    const missing = (rowByLabel.get(label)?.missingNames ?? []).map((name) => ({ name, present: false, src: label }));
    // Sourceless name-references from table text are review material, not a
    // curated bestiary — label the bucket honestly (E2E D8).
    const displayLabel = label === "Custom" ? "Unresolved encounter references" : label;
    const node = leaf(`monsters/${label}`, displayLabel, "fa-dragon", [...present, ...missing], "monsterSeedPaste");
    // Incomplete published bestiary → one direct paste/import row.
    const expected = BESTIARY_COUNTS[label];
    if (expected && node.have < expected) {
      node.entries.unshift({
        name: `Import the ${label} bestiary — ${expected} monsters (paste the book's bestiary)`,
        present: false, seedAction: "monsterSeedPaste", type: "Actor", src: label, pages: "",
      });
      node.locked = expected - node.have;
    }
    return node;
  };

  const children = [];
  const seen = new Set();
  for (const label of MONSTER_SOURCES) { seen.add(label); children.push(makeLeaf(label)); }
  for (const label of new Set([...presentByLabel.keys(), ...rowByLabel.keys()])) {
    if (!seen.has(label)) children.push(makeLeaf(label));
  }
  return branch("monsters", "Monsters", "fa-dragon", children);
}

/**
 * Items top-level branch, grouped by type (Magic Items = Potion+Scroll+Wand).
 * Each leaf enumerates already-imported items of that type (from sde-items)
 * plus importable manifest gear (char-builder gear the system doesn't ship).
 */
function buildItems(charEntries, itemRecords) {
  const typeLeaf = (id, label, icon, types) => {
    // Imported items of these types (deduped by name).
    const seenName = new Set();
    const present = [];
    for (const r of itemRecords) {
      if (!types.includes(r.type)) continue;
      const k = _norm(r.name);
      if (seenName.has(k)) continue;
      for (const v of nameVariants(r.name)) seenName.add(v);   // qty/comma variants flip aliases
      present.push({ name: r.name, present: true, type: r.type });
    }
    // Importable manifest gear of these types not already present.
    const importable = charEntries
      .filter((e) => types.includes(e.type) && !e.present && !nameVariants(e.name).some((v) => seenName.has(v)))
      .map((e) => ({ name: e.name, present: false, type: e.type, src: e.src, pages: e.pages }));
    return leaf(id, label, icon, [...present, ...importable], "charSeedPaste");
  };
  const basic = typeLeaf("items/basic", "Basic Gear", "fa-box-open", ["Basic"]);
  const armor = typeLeaf("items/armor", "Armor", "fa-shield-halved", ["Armor"]);
  const weapons = typeLeaf("items/weapons", "Weapons", "fa-gavel", ["Weapon"]);
  const magic = typeLeaf("items/magic", "Magic Items", "fa-hat-wizard", ["Potion", "Scroll", "Wand"]);
  return branch("items", "Items", "fa-gem", [basic, armor, weapons, magic]);
}

/**
 * Compose the full Manage tree from the live censuses. Returns the array of the
 * four top-level nodes (Character Content, Spells, Monsters, Items). Expand state
 * and per-node depth are applied by the caller (importer-hub-app).
 * @returns {Promise<Array<object>>}
 */
export async function buildManageTree() {
  const presence = await gatherPresence();
  const [charEntries, monsterRows, actorRecords, itemRecords, spellListCensus] = await Promise.all([
    gatherCharContentEntries(presence),
    gatherCensus().catch((err) => { console.error("shadowdark-enhancer | monster census failed:", err); return []; }),
    liveActorRecords().catch((err) => { console.error("shadowdark-enhancer | actor records failed:", err); return []; }),
    liveItemRecords().catch((err) => { console.error("shadowdark-enhancer | item records failed:", err); return []; }),
    gatherSpellListCensus().catch((err) => { console.error("shadowdark-enhancer | spell-list census failed:", err); return new Map(); }),
  ]);
  return [
    buildCharContent(charEntries),
    buildSpells(spellListCensus),
    buildGameplay(charEntries, presence.tablesPresent),
    buildRollTables(charEntries, presence.tablesPresent),
    buildMonsters(monsterRows, actorRecords),
    buildItems(charEntries, itemRecords),
  ];
}
