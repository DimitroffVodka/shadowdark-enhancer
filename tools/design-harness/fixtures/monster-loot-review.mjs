// Monster Loot Overrides with a full bestiary: 36 NPCs (long names, a third with overrides, one pointing at a deleted
// table), 9 tables in every dropdown, combat drops on and per-encounter.
const tables = ["Treasure 0-3", "Treasure 4-6", "Treasure 7-9", "Treasure 10+", "Goblin Warren Trophies and Trinkets", "Western Reaches Wandering Hoard", "Dragon Hoard (Level 8+)", "Luxury Items", "Sea Wolf Plunder From Distant Lands"].map((name, i) => ({ uuid: "t" + i, name }));
const names = ["Goblin", "Goblin Shaman", "Mithral chain shirt of the Lantern Hold, enchanted by Orlandu of the Seven Spires for a long-forgotten king", "Giant Rat", "Dire Wolf", "Supercalifragilisticexpialidocious_Longsword_of_Unbreakingness_Plus_Three", "Troll of the Whispering Marsh", "Skeleton", "Zombie", "Wraith", "Ancient Red Dragon", "Bandit Captain", "Cult Fanatic", "Giant Spider", "Mimic", "Owlbear", "Basilisk", "Gelatinous Cube", "Harpy", "Minotaur", "Stone Golem", "Vampire Spawn", "Wight", "Ghoul", "Kobold Trapmaster", "Orc Chieftain", "Sahuagin Priestess of the Drowned Queen", "Shambling Mound", "Wyvern", "Young Green Dragon", "Fire Elemental", "Imp", "Cave Bear", "Lizardfolk Hunter", "Swamp Hag", "Bugbear"];
const rows = names.map((name, i) => {
  const overridden = i % 3 === 0, missing = i === 6;
  return { id: "n" + i, name, nameKey: name.toLowerCase(), level: (i % 10) + 1, table: overridden ? (missing ? "gone" : tables[i % tables.length].uuid) : "", chance: i % 4 === 0 ? 75 : "", overridden,
    defaultLabel: i % 7 === 0 ? "Default (no table for this level)" : "Default: Treasure " + ["0-3", "4-6", "7-9", "10+"][Math.floor(i / 10)], missingTable: missing ? "Deleted Hoard Table" : null };
});
export default {
  title: "SDE.settings.monsterLoot.title", icon: "fa-solid fa-coins", classes: ["sde-monster-loot"], resizable: true, width: 780, height: 640, template: "templates/monster-loot-review.hbs",
  context: { rows, tables, worldChance: 50, dropsOn: true, perEncounter: true },
};
