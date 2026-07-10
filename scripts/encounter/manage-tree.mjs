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
 *   Monsters          → CS1…CS6 · Western Reaches (fixed skeleton) + any other present source
 *   Items             → Basic Gear · Armor · Weapons · Magic Items (Potion+Scroll+Wand)
 */
import {
  gatherPresence, gatherCharContentEntries, classesForTalent,
  CLASS_ABILITIES, MANIFEST_CLASSES, CHAR_SOURCES,
} from "./char-content-manifest.mjs";
import { gatherCensus, liveActorRecords } from "./monster-census-live.mjs";
import { liveItemRecords } from "./item-census-live.mjs";
import { sourceFolderName } from "./compendium-suite.mjs";

const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Fixed monster-source skeleton so empty sources still render (0 locked). */
const MONSTER_SOURCES = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

/**
 * Sealed monster bestiaries (source label → monster count). The monster census
 * is reference-driven (gaps come from pack tables that name a monster), so in a
 * fresh world nothing surfaces even though these bestiaries ship sealed. We add
 * one direct "Unlock N monsters" row per source so they're discoverable without
 * first importing a referencing table. Counts match the cs*-monsters units.
 */
const SEALED_BESTIARIES = { CS1: 14, CS2: 14, CS3: 12, CS4: 19, CS5: 5 };

/** Sort a leaf's entries: importable (locked) first, then imported, alpha within. */
function sortEntries(entries) {
  return entries.slice().sort((a, b) =>
    (Number(a.present) - Number(b.present)) || a.name.localeCompare(b.name));
}

/**
 * Leaf node that enumerates its FULL contents from presence-tagged records
 * (`{ name, present, type?, src?, pages? }`): imported entries render as
 * "in library", not-present entries carry an Unlock button (`seedAction`).
 * `have` = imported count; `locked` = importable count.
 */
function leaf(id, label, icon, records, seedAction) {
  const entries = sortEntries(records.map((r) => ({
    name: r.name,
    present: !!r.present,
    seedAction,
    type: r.type ?? "",
    src: r.src ?? "",
    pages: r.pages ?? "",
  })));
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
function buildCharContent(charEntries, abilityPresent) {
  const ofType = (t) => charEntries.filter((e) => e.type === t);
  const srcOfClass = new Map(ofType("Class").map((e) => [e.name, e.src]));

  // Ancestries: Ancestry items + the WR ancestry Names/Trinkets tables.
  const ancestryRecords = charEntries.filter((e) => e.type === "Ancestry" || e.type === "Table");
  const ancestries = leaf("char/ancestries", "Ancestries", "fa-people-group", ancestryRecords, "charSeedPaste");

  const backgrounds = leaf("char/backgrounds", "Backgrounds", "fa-scroll", ofType("Background"), "charSeedPaste");

  // Route each talent to its class (1 class) or Multi (0 = unmapped, or 2+ shared).
  const perClass = new Map();
  const multiTalents = [];
  for (const rec of ofType("Talent")) {
    const cls = classesForTalent(rec.name);
    if (cls.length === 1) {
      if (!perClass.has(cls[0])) perClass.set(cls[0], []);
      perClass.get(cls[0]).push(rec);
    } else {
      multiTalents.push(rec);
    }
  }

  const classNodes = MANIFEST_CLASSES.map((cls) => {
    const src = srcOfClass.get(cls) ?? "";
    const abilityRecords = (CLASS_ABILITIES[cls] ?? []).map((name) => ({
      name, present: abilityPresent(name), type: "Talent", src, pages: "",
    }));
    const abilities = leaf(`char/classes/${cls}/abilities`, "Class Abilities", "fa-star", abilityRecords, "charSeedPaste");
    const talents = leaf(`char/classes/${cls}/talents`, "Talents", "fa-certificate", perClass.get(cls) ?? [], "charSeedPaste");
    return branch(`char/classes/${cls}`, cls, "fa-user-shield", [abilities, talents]);
  });
  const multi = leaf("char/classes/Multi", "Multi", "fa-users", multiTalents, "charSeedPaste");
  const classes = branch("char/classes", "Classes", "fa-users-rectangle", [...classNodes, multi]);

  const patrons = {
    id: "char/patrons", label: "Patrons & Deities", icon: "fa-hands-praying",
    have: 0, locked: 0, entries: [], children: [],
    placeholder: true, note: "No content catalogued yet — this folder will fill as patrons & deities are added.",
  };

  return branch("char", "Character Content", "fa-user-plus", [ancestries, backgrounds, classes, patrons]);
}

/** Spells top-level branch, sub-grouped by source. */
function buildSpells(charEntries) {
  const spellRecs = charEntries.filter((e) => e.type === "Spell");
  const sources = [...new Set(spellRecs.map((r) => r.src))];
  const children = sources.map((src) =>
    leaf(`spells/${src}`, CHAR_SOURCES[src]?.label ?? src, "fa-wand-sparkles",
      spellRecs.filter((r) => r.src === src), "charSeedPaste"));
  return branch("spells", "Spells", "fa-book-sparkles", children);
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
  const abilityPresent = (name) => presence.presentNames.has(_norm(name));

  return [
    buildCharContent(charEntries, abilityPresent),
    buildSpells(charEntries),
    buildMonsters(monsterRows, actorRecords),
    buildItems(charEntries, itemRecords),
  ];
}
