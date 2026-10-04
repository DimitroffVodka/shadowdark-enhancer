// Importer Hub (ImporterHubApp), real template, busiest states a GM can reach. Audit fixture.
//   state: paste | parsed | chars | tables | hexes | downtime | manage
// Needs the sdeTreeNode partial (module registers it at runtime), supplied by _importer-common.mjs.
import "./_importer-common.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EN = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../languages/en.json"), "utf8"));
const L = (k) => EN[k] ?? k;

const ABIL = [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]].map(([key, label]) => ({ key, label }));
const monster = (name, extra = {}) => ({
  name, level: 4, ac: 13, hp: { value: 18, max: 18 }, alignment: "C", move: "near", moveNote: "climb",
  abilities: { str: 2, dex: 1, con: 1, int: -2, wis: 0, cha: -1 }, spellcasting: { ability: "", bonus: 0, attacks: 0 },
  actions: [
    { num: 2, name: "claw", type: "NPC Attack", bonus: 3, damage: "1d6", ranges: ["close"], description: "" },
    { num: 1, name: "venomous bite and a very long attack name to test wrapping behaviour", type: "NPC Special Attack", bonus: 0, damage: "", ranges: ["close", "near"], description: "DC 12 CON or paralyzed for 1d4 rounds, and the victim is dragged one near" },
  ],
  features: [{ name: "Web Walker", description: "Ignores difficult terrain made of webs and can climb any surface without a check." }, { name: "Skittering Swarm", description: "Splits into two smaller swarms when reduced below half hit points." }],
  ...extra,
});
const mcards = [
  { name: "Giant Cave Spider", warnings: ["AC could not be read, defaulted to 10"], warn: { ac: true }, mod: { ac: 10 } },
  { name: "Lamprey Queen of the Drowned Cathedral", warnings: [], warn: {} },
  { name: "Bone Hound", warnings: ["Attack \"venomous bite and a very long attack name to test wrapping behaviour\" has no damage", "Alignment missing"], warn: { alignment: true, attacks: true } },
].map((c, i) => {
  const draft = monster(c.name, c.mod ?? {});
  return {
    idx: i, draft, warnings: c.warnings, hasWarnings: c.warnings.length > 0, warnCount: c.warnings.length, warn: { ac: false, hp: false, alignment: false, level: false, move: false, abilities: false, attacks: false, spellcasting: false, ...c.warn },
    features: draft.features, actions: draft.actions.map((a, j) => ({ ...a, flagged: i === 2 && j === 1, flagReason: "No damage found" })),
  };
});
const ITEMS = ["Dragonbone Longsword", "Potion of Greater Healing", "Cloak of the Wandering Star Merchant"].map((name, i) => ({
  idx: i, draft: { name, type: ["Weapon", "Potion", "Basic"][i], cost: { gp: 150 * (i + 1), sp: 5, cp: 0 }, slots: { slots_used: i + 1 }, description: "A very long description of the item that goes on for a while so the textarea has something to show the reader." },
  statLine: i === 0 ? "1d8 · melee · versatile 1d10 · +1 attack and damage" : "", warnings: i === 2 ? ["Type guessed from name"] : [], hasWarnings: i === 2, warnCount: i === 2 ? 1 : 0,
}));
const SPELLS = ["Fireball of the Mighty Emberwind", "Sleep", "Detect Magic"].map((name, i) => ({
  idx: i, draft: { name, tier: i + 1, className: "wizard", range: ["far", "near", "self"][i], duration: { type: ["instant", "rounds", "focus"][i], value: 5 }, description: "<p>Description text of the spell that reads across several lines when shown in the textarea of the hub window.</p>" },
  warnings: i === 0 ? ["Duration unclear"] : [], hasWarnings: i === 0, warnCount: i === 0 ? 1 : 0,
}));
const TABLE = (name, n) => ({
  name, formula: `1d${n}`, replacement: false, category: "gameplay", customLabel: "", bestEffort: name.includes("Weird"), warnings: name.includes("Weird") ? ["Rows 9-10 overlap"] : [],
  rows: Array.from({ length: Math.min(n, 12) }, (_, i) => ({ min: i + 1, max: i + 1, text: `Result number ${i + 1}: something happens in the corridor that goes on and on and on for a long while`, link: i === 2 ? { name: "Giant Spider" } : null })),
});
const GEN = { idx: 0, name: "Monster Generator", formula: "3d6", separator: " ", columns: [{ idx: 0, label: "Adjective" }, { idx: 1, label: "Creature" }, { idx: 2, label: "Feature" }], colCount: 3,
  faces: Array.from({ length: 6 }, (_, f) => ({ face: f + 1, cells: [{ colIdx: 0, text: "Slimy" }, { colIdx: 1, text: "Goblin" }, { colIdx: 2, text: "with a third eye" }] })), warnings: [], hasWarnings: false, isCartesian: false };

const SOURCES = ["", "Core Rulebook", "Western Reaches GM Guide", "Cursed Scroll 1", "Cursed Scroll 2", "Cursed Scroll 3"].map((v, i) => ({ value: v, label: v || "-", selected: i === 2 }));
const typeGroups = (t) => [
  { group: "Paste and parse", options: ["auto", "monsters", "items", "tables", "boats", "backgrounds", "talents", "ancestries", "generators", "cartesian"].map((v) => ({ value: v, label: v, selected: v === t })) },
  { group: "Guided", options: ["__spells", "__classes"].map((v) => ({ value: v, label: v, selected: v === t })) },
];

const baseImport = (t, extra = {}) => ({
  text: "", source: "Western Reaches GM Guide", sourceOptions: SOURCES, seed: null, seedPdfHref: null, seedResult: null,
  importType: t, formatExample: "Paste any Shadowdark stat block, item list or table.", typeGroups: typeGroups(t),
  showItemSubtype: t === "items" || t === "auto", showGenSpec: false, genSpec: "", itemSubtypeOptions: ["auto", "Basic", "Weapon", "Armor"].map((v) => ({ value: v, label: v, selected: v === "auto" })),
  monsters: [], items: [], spells: [], tables: [], boats: [], hexes: [], generators: [], skipped: [], chars: [],
  hexCount: 0, hexTitle: "", hexSummaryCount: 0, hexCrawlDone: null, hexPinScene: null, hexViaExtras: false,
  hasMonsters: false, hasItems: false, hasSpells: false, hasTables: false, hasBoats: false, hasHexes: false, hasGenerators: false, showImportAll: false,
  downtime: null, hasDowntime: false, hasChar: false, charsCount: 0, charsTitle: "Character content", charsCommitLabel: "Import to compendium",
  skippedCount: 0, monstersCount: 0, itemsCount: 0, spellsCount: 0, tablesCount: 0, generatorsCount: 0, cartesianMode: false, cartesianTotal: "0",
  itemTypeOptions: ["Basic", "Weapon", "Armor", "Potion", "Scroll", "Wand"], spellRanges: ["self", "touch", "close", "near", "doubleNear", "far"],
  spellDurationTypes: ["instant", "focus", "permanent", "rounds", "days", "turns"],
  categoryOptions: [{ id: "gameplay", label: "Gameplay" }, { id: "roll", label: "Roll Tables" }, { id: "custom", label: "Custom folder..." }],
  alignments: ["L", "N", "C"], moveOptions: ["none", "close", "near", "double near", "far"],
  spellAbilities: [{ value: "", label: "-" }, { value: "int", label: "INT" }, { value: "wis", label: "WIS" }, { value: "cha", label: "CHA" }],
  attackTypes: ["NPC Attack", "NPC Special Attack"], abilityKeys: ABIL, ...extra,
});

const unit = {
  hp: "d6", weaponsText: "dagger, shortsword, crossbow, longbow, staff, wand", armorText: "leather armor, chainmail", allWeapons: false, allMeleeWeapons: false, allRangedWeapons: true, allArmor: false,
  langFixed: "Common, Elvish", langCommon: 1, langRare: 0, flavor: "The Warlock of the Sundered Crown bargains with a patron far older than the gods, trading memory and blood for fragments of impossible power.",
  features: [{ name: "Patron Bond", text: "You forge a pact with a patron of your choice and gain a boon each time you rest in a place sacred to it." }, { name: "Eldritch Spark", text: "Once per round you may add 1d4 damage to a spell attack." }, { name: "Cursed Inheritance", text: "When you roll a natural 1 on a spellcasting check, the patron takes a small payment." }],
  table: { formula: "2d6", rows: [{ range: "2", text: "Gain +2 to Intelligence or Charisma rolls", options: ["+2 INT", "+2 CHA"], isChoice: true }, { range: "3-6", text: "Gain a Patron boon", options: [], isChoice: false }, { range: "7-9", text: "+1 to spellcasting checks", options: [] }, { range: "12", text: "Choose a talent or +2 points to distribute", options: [], grand: true }] },
  isCaster: true, scText: "Warlocks cast spells using Charisma as their spellcasting ability.", spellListOptions: [{ value: "", label: "Own list (Warlock)", selected: true }, { value: "w", label: "Wizard", selected: false }],
  spellsKnown: [{ level: 1, cells: "2 · — · —" }, { level: 2, cells: "3 · — · —" }, { level: 3, cells: "3 · 1 · —" }],
  scOptions: [{ value: "", label: "- not a caster", selected: false }, { value: "cha", label: "CHA", selected: true }],
  titles: [{ range: "1-2", lawful: "Pawn", chaotic: "Cultist", neutral: "Acolyte" }, { range: "3-4", lawful: "Scholar", chaotic: "Blighter", neutral: "Adept" }, { range: "5-6", lawful: "Archivist of the Hidden Library", chaotic: "Herald", neutral: "Seeker" }],
  stage1: false, warnings: ["Talent row 12 might be a grand-choice row", "No spells-known table found"],
};

const treeTree = [
  { id: "cc", label: "Character Content", icon: "fa-user-plus", depth: 0, expandable: true, expanded: true, have: 18, locked: 24, runnable: 12, fillable: 3, children: [
    { id: "cc-bg", label: "Backgrounds", icon: "fa-scroll", depth: 1, expandable: true, expanded: true, have: 6, locked: 4, runnable: 4, entries: [
      { name: "Bounty Hunter", present: true, type: "Background", src: "CS", pages: "12", countNote: "" },
      { name: "Cartographer of the Western Reaches", present: true, type: "Background", src: "WR", pages: "30-31", pagesAlt: "88", fillDesc: true },
      { name: "Grave Robber", present: false, type: "Background", src: "CS2", pages: "40", seedAction: "charSeedPaste", isNew: true },
      { name: "Hedge Wizard", present: false, type: "Background", src: "CS2", pages: "41", seedAction: "charSeedPaste", stateNote: "Partial (21/25)" },
    ] },
    { id: "cc-cl", label: "Classes", icon: "fa-hat-wizard", depth: 1, expandable: true, expanded: false, have: 4, locked: 3 },
  ] },
  { id: "sp", label: "Spells", icon: "fa-wand-sparkles", depth: 0, expandable: true, expanded: false, have: 120, locked: 40 },
  { id: "mo", label: "Monsters", icon: "fa-dragon", depth: 0, expandable: true, expanded: true, have: 300, locked: 85, placeholder: true, note: "Monsters from a book are listed by page; open the PDF to copy a stat block.", children: [], entries: [
    { name: "Bone Hound", present: true, type: "Monster", src: "CS1", pages: "8", countNote: "2 versions" },
    { name: "Drowned Priest of Yss", present: false, type: "Monster", src: "WR", pages: "112", seedAction: "monsterSeedPaste", importLabel: "Import" },
  ] },
  { id: "ta", label: "Tables", icon: "fa-table-list", depth: 0, expandable: true, expanded: false, have: 90, locked: 10 },
];
const dupGroups = [{ key: "giant spider", members: [{ uuid: "a", name: "Giant Spider", source: "Core Rulebook", date: "2026-09-12" }, { uuid: "b", name: "Giant Spider", source: "Western Reaches", date: "2026-10-01" }, { uuid: "c", name: "Giant Spider", source: "", date: "" }] }, { key: "wolf", members: [{ uuid: "d", name: "Wolf", source: "Core", date: "2026-09-12" }, { uuid: "e", name: "Wolf", source: "Core", date: "2026-09-12" }] }];

const rulesRows = ["terrain", "terrainTypes", "travel", "visibility", "climate", "carousing", "recruiting"].map((id, i) => ({ id, name: L(`SDE.rulesData.table.${id}`), filled: i < 3, cite: "GM Guide, p. " + (30 + i), needs: L(`SDE.rulesData.step.needs.${id}`) }));
const rulesStep = { rows: rulesRows, n: 3, total: 7, complete: false, linked: false };

const build = (state) => {
  let importData;
  if (state === "parsed") {
    importData = baseImport("auto", { text: "ENHANCED SYNTHETIC\nAC 13, HP 9, ATK 1 beam +3 (1d6)\n...", monsters: mcards, hasMonsters: true, monstersCount: 3, items: ITEMS, hasItems: true, itemsCount: 3, spells: SPELLS, hasSpells: true, spellsCount: 3,
      boats: [{ name: "River Cog", cost: 400, ac: 11, hp: 30, speed: "near", gearSlots: 60, props: "keel, mast, rowing benches, cargo hold" }], hasBoats: true,
      skipped: [{ name: "Random Encounters", reason: "Looked like a table heading" }, { name: "Introduction", reason: "No stat line" }], skippedCount: 2, showImportAll: true });
  } else if (state === "chars") {
    importData = baseImport("classes", { chars: [
      { name: "Warlock of the Sundered Crown", type: "Class", unit, supplement: null, meta: null, preview: "" },
      { name: "Titles and Talents Supplement", type: "Class", unit: null, supplement: { hasTable: true, tableRows: 11, titles: unit.titles, spellsKnown: unit.spellsKnown, extraTables: [{ name: "Corruption", rows: 12 }], warnings: ["Row 9 may be part of the next table"], attachOptions: [{ value: "", label: "- choose a class -", selected: true }, { value: "w", label: "Warlock", selected: false }] }, meta: null, preview: "" },
      { name: "Gnoll", type: "Ancestry", unit: null, supplement: null, meta: { languages: "Common, Gnollish, +1 common", talent: "Pack Hunter", talentText: "Advantage on attack rolls against a creature an ally is adjacent to." }, preview: "Hyena-headed raiders of the Sunbaked Steppe, gnolls prize loyalty to the pack above all." },
    ], hasChar: true, charsCount: 3 });
  } else if (state === "tables") {
    importData = baseImport("tables", { text: "1 Result one\n2 Result two", tables: [TABLE("Dungeon Wandering Monsters", 12), TABLE("Make It Weird", 12)], hasTables: true, tablesCount: 2,
      generators: [GEN], hasGenerators: true, generatorsCount: 1, skipped: [{ name: "Notes", reason: "Prose block" }], skippedCount: 1 });
  } else if (state === "hexes") {
    importData = baseImport("auto", { hexes: Array.from({ length: 10 }, (_, i) => ({ num: `${(i + 1) * 101}`, name: `Ruined watchtower number ${i + 1}`, lines: 12, warnings: i === 3 ? ["No keyed monster"] : [], warn: i === 3 })), hasHexes: true, hexCount: 12, hexTitle: "Western Reaches hex crawl", hexSummaryCount: 2,
      hexCrawlDone: { uuid: "x", title: "Western Reaches hex crawl" }, hexPinScene: "Western Reaches" });
  } else if (state === "downtime") {
    importData = baseImport("downtime", { hasDowntime: true, downtime: { expected: 25, label: "Cursed Scroll 6", pages: "40-41", result: { filledCount: 21, complete: false, canCommit: true, warnings: [{ text: "Slot 7 text is short", info: false }, { text: "Recovered two-column text", info: true }], unfilled: ["Gambling den", "Tournament", "Sabotage rival", "Smuggling"], unmatched: [{ dc: "14", paid: true, text: "You lose a day to carousing and spend 50 gp." }] } } });
  } else {
    importData = baseImport("auto", { seed: { name: "Monster Generator", book: "Western Reaches GM Guide", page: "22", die: "3d6", src: "WR" }, seedPdfHref: "x" });
    if (state === "paste") importData.seed = null, importData.seedPdfHref = null;
  }
  const manage = state === "manage" ? {
    monstersData: { hasDuplicates: true, duplicateCount: 5, duplicateGroups: dupGroups }, itemsData: { hasDuplicates: true, duplicateCount: 3, duplicateGroups: dupGroups.slice(0, 1) },
    tree: treeTree, filterAll: true, filterLocked: false, filterImported: false, filterNew: false, newTotal: 6, search: "", searching: false, filterEmpty: false, lockedTotal: 160, runnableTotal: 88,
  } : null;
  return { context: { importData, manageExpanded: state === "manage", manage, batch: state === "manage" ? { total: 88, done: 31, percent: 35, cancelled: false, current: "Bone Hound" } : null, rulesStep } };
};

export default {
  id: "sde-importer-hub", title: "SDE.importer.app.title", icon: "fas fa-file-import", classes: [], width: 860, height: 780,
  template: "templates/importer-hub.hbs", initial: "paste", build, resizable: true,
  toolbar: ["paste", "parsed", "chars", "tables", "hexes", "downtime", "manage"].map((s) => `<a href="?state=${s}" style="color:#9cf">${s}</a>`).join(" | "),
  actions: {},
};
