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
  gatherPresence, gatherCharContentEntries, hasTable,
  MANIFEST_CLASSES, CHAR_SOURCES, ANCESTRY_TABLES, BACKGROUND_TABLES,
} from "./char-content-manifest.mjs";
import { coreGroupsFor } from "./core-table-groups.mjs";
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
 * Sealed monster bestiaries (source label → monster count). The monster census
 * is reference-driven (gaps come from pack tables that name a monster), so in a
 * fresh world nothing surfaces even though these bestiaries ship sealed. We add
 * one direct "Unlock N monsters" row per source so they're discoverable without
 * first importing a referencing table. Counts match the cs*-monsters units.
 */
const SEALED_BESTIARIES = { CS1: 14, CS2: 14, CS3: 12, CS4: 19, CS5: 5 };

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

  // Ancestries: Ancestry items + the WR ancestry Names/Trinkets tables only —
  // every other Table entry (carousing, encounters, boons, prayers…) lives in
  // the top-level Roll Tables branch, not here.
  const ancestryTableNames = new Set(ANCESTRY_TABLES.map((t) => _norm(t.name)));
  const ancestryRecords = charEntries.filter((e) =>
    e.type === "Ancestry" || (e.type === "Table" && ancestryTableNames.has(_norm(e.name))));
  const ancestries = leaf("char/ancestries", "Ancestries", "fa-people-group", ancestryRecords, "charSeedPaste");

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

  // Patrons & Deities: every god prayer generator + patron boon table (see
  // PATRON_TABLES). Core-system reprints resolve present via their system copy.
  const patronRecords = charEntries.filter((e) =>
    e.type === "Table" && PATRON_TABLES.has(_norm(e.name)));
  const patrons = leaf("char/patrons", "Patrons & Deities", "fa-hands-praying", patronRecords, "charSeedPaste");

  return branch("char", "Character Content", "fa-user-plus", [ancestries, backgrounds, classes, patrons]);
}

/** Spells top-level branch, sub-grouped by source. */
function buildSpells(charEntries) {
  const spellRecs = charEntries.filter((e) => e.type === "Spell");
  const sources = [...new Set(spellRecs.map((r) => r.src))]
    .sort((a, b) => (CHAR_SOURCES[a]?.label ?? a).localeCompare(CHAR_SOURCES[b]?.label ?? b));
  const children = sources.map((src) =>
    leaf(`spells/${src}`, CHAR_SOURCES[src]?.label ?? src, "fa-wand-sparkles",
      spellRecs.filter((r) => r.src === src), "charSeedPaste", true));
  return branch("spells", "Spells", "fa-book-sparkles", children);
}

/**
 * A single Core Rulebook table BUNDLE as a leaf: its member tables enumerated
 * from CORE_TABLE_GROUPS, grouped under the section header. De-sealed: each
 * sub-table is INDIVIDUALLY unlockable and INDIVIDUALLY present-checked by its
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
    const present = [...(presentByLabel.get(label)?.values() ?? [])].map((name) => ({ name, present: true }));
    const missing = (rowByLabel.get(label)?.missingNames ?? []).map((name) => ({ name, present: false }));
    const node = leaf(`monsters/${label}`, label, "fa-dragon", [...present, ...missing], "monsterSeedPaste");
    // Sealed bestiary that isn't fully imported here → one direct Unlock row.
    const sealed = SEALED_BESTIARIES[label];
    if (sealed && node.have < sealed) {
      node.entries.unshift({
        name: `Unlock the ${label} bestiary — ${sealed} monsters (paste the book's bestiary)`,
        present: false, seedAction: "monsterSeedPaste", type: "Actor", src: label, pages: "",
      });
      node.locked = sealed - node.have;
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
      seenName.add(k);
      present.push({ name: r.name, present: true, type: r.type });
    }
    // Importable manifest gear of these types not already present.
    const importable = charEntries
      .filter((e) => types.includes(e.type) && !e.present && !seenName.has(_norm(e.name)))
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
  const [charEntries, monsterRows, actorRecords, itemRecords] = await Promise.all([
    gatherCharContentEntries(presence),
    gatherCensus().catch((err) => { console.error("shadowdark-enhancer | monster census failed:", err); return []; }),
    liveActorRecords().catch((err) => { console.error("shadowdark-enhancer | actor records failed:", err); return []; }),
    liveItemRecords().catch((err) => { console.error("shadowdark-enhancer | item records failed:", err); return []; }),
  ]);
  return [
    buildCharContent(charEntries),
    buildSpells(charEntries),
    buildGameplay(charEntries, presence.tablesPresent),
    buildRollTables(charEntries, presence.tablesPresent),
    buildMonsters(monsterRows, actorRecords),
    buildItems(charEntries, itemRecords),
  ];
}
