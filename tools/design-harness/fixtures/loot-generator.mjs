// The Loot Generator at its busiest: a long table list, four rolls in the history (items, coins, notes, an empty roll),
// six party members in every Give dropdown. state: busy | favourites (two starred tables, a lit star, the Party sheet choice) | empty (no tables yet, setup needed).
const tables = ["Treasure Tier 0-3 (Core Rulebook)", "Treasure Tier 4-6 (Core Rulebook)", "Treasure Tier 7-9 (Core Rulebook)", "Treasure Tier 10+ (Core Rulebook)", "Western Reaches Wandering Hoard", "Goblin Warren Trophies and Trinkets", "Sunken Temple of the Drowned Queen: Reliquary Contents", "Cursed Rings (homebrew)"]
  .map((name, i) => ({ uuid: "t" + i, name, isSelected: i === 0 }));
const party = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast", "Bartholomew the Unfortunate"].map((name, i) => ({ id: "p" + i, name }));
const it = (name, forgeable = false) => ({ name, img: "/icons/svg/item-bag.svg", forgeable });
const history = [
  { id: "e1", tableName: "Treasure Tier 0-3 (Core Rulebook)", items: [it("Longsword of Unnecessarily Long Names +1", true), it("Potion of Healing"), it("Rope, 60 feet")].map((x, idx) => ({ ...x, idx })), notes: ["A faint smell of wet dog clings to everything in this chest."], hasCoins: true, coinsLabel: "34 gp, 12 sp, 5 cp", isEmpty: false, party, hasParty: true },
  { id: "e2", tableName: "Western Reaches Wandering Hoard", items: [it("Scroll of Fireball", true), it("Gem: Black opal (100 gp)"), it("Silver Mirror")].map((x, idx) => ({ ...x, idx })), notes: [], hasCoins: true, coinsLabel: "120 gp", isEmpty: false, party, hasParty: true },
  { id: "e3", tableName: "Goblin Warren Trophies and Trinkets", items: [], notes: ["Nothing but chewed bones and a single boot."], hasCoins: false, coinsLabel: "", isEmpty: false, party, hasParty: true },
  { id: "e4", tableName: "Cursed Rings (homebrew)", items: [], notes: [], hasCoins: false, coinsLabel: "", isEmpty: true, party, hasParty: true },
];
// favourites: the second and fifth tables are starred, and the first one shown is one of them (a lit star).
const starred = new Set(["t4", "t5"]);
const withFavs = (selected) => tables.map((t) => ({ ...t, isSelected: t.uuid === selected }));
const build = (state) => state === "empty"
  ? { context: { tables: [], hasTables: false, noneMarked: false, history: [], hasHistory: false, needsSetup: true } }
  : state === "favourites"
    ? { context: { tables: withFavs("t4"), favouriteTables: withFavs("t4").filter((t) => starred.has(t.uuid)), otherTables: withFavs("t4").filter((t) => !starred.has(t.uuid)), hasFavourites: true, favOnly: false, selectedIsFav: true, hasParty: true, hasTables: true, noneMarked: false, history, hasHistory: true, needsSetup: false } }
    : { context: { tables, favouriteTables: [], otherTables: tables, hasFavourites: false, favOnly: false, selectedIsFav: false, hasParty: true, hasTables: true, noneMarked: false, history, hasHistory: true, needsSetup: true } };
export default {
  title: "SDE.loot.generator.title", icon: "fas fa-coins", classes: ["sde-ui", "sde-lootgen"], resizable: true, width: 560, template: "templates/loot-generator.hbs",
  initial: "busy", build, toolbar: `<span>State:</span><button data-action="s" data-state="busy">busy</button><button data-action="s" data-state="empty">empty</button><button data-action="s" data-state="favourites">favourites</button>`,
  actions: { s: { state: "{state}" } },
};
