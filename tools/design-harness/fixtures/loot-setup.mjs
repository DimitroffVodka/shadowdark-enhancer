// Loot Setup at its busiest: both library groups (Core 4 tiers + Luxury, Cursed Scroll) in mixed states (bound, present
// but unbound, not unlocked), six tables already added to the picker, a long add list and a long custom-bind list.
// The group/entry shapes are the ones LootSetupApp._prepareContext builds from LOOT_LIBRARY.
const e = (name, displayName, page, tier, present, boundHere) => ({ name, displayName, src: tier ? "CORE" : "CS1", page, tier, isTier: !!tier, present, uuid: present ? "u-" + name : null, boundHere });
const library = [
  { label: "Core Rulebook", entries: [e("TREASURE 0-3", "TREASURE 0-3", "270-271", "0-3", true, true), e("TREASURE 4-6", "TREASURE 4-6", "272-273", "4-6", true, true),
    e("TREASURE 7-9", "TREASURE 7-9", "274-275", "7-9", true, false), e("TREASURE 10+", "TREASURE 10+", "276-277", "10+", false, false), e("Luxury Items", "Luxury Items", "279", null, true, false)] },
  { label: "Cursed Scroll", entries: [e("Cursed Scroll 1 p68: Diabolical Treasure", "Diabolical Treasure", "68", null, true, false), e("Sea Wolf Plunder From Distant Lands", "Sea Wolf Plunder From Distant Lands and Other Treasure of the Drowned Kings of the Western Reaches", "68", null, false, false)] },
];
const names = ["Supercalifragilisticexpialidocious_Longsword_of_Unbreakingness_Plus_Three", "Western Reaches Wandering Hoard", "Sunken Temple of the Drowned Queen: Reliquary", "Cursed Rings (homebrew)", "Dragon Hoard (Level 8+)", "Tomb of the Forgotten King: Burial Goods"];
const managed = names.map((name, i) => ({ uuid: "m" + i, name, group: i % 2 ? "World" : "sde-tables" }));
const addable = Array.from({ length: 30 }, (_, i) => ({ uuid: "a" + i, name: "Random Table Number " + (i + 1) + " with a moderately long title", group: i % 3 ? "Shadowdark Roll Tables" : "World" }));
export default {
  title: "SDE.loot.setup.title", icon: "fas fa-gear", classes: ["sde-ui", "sde-lootsetup"], resizable: true, width: 620, template: "templates/loot-setup.hbs",
  context: {
    library, lootTables: addable.slice(0, 12), hasLootTables: true, done: 2, total: 4, managed, addable, hasAddable: true,
    tierOptions: [["0-3", "Treasure Tables 0-3"], ["4-6", "Treasure Tables 4-6"], ["7-9", "Treasure Tables 7-9"], ["10+", "Treasure Tables 10+"]].map(([tier, label], i) => ({ tier, label: "Tier " + tier, boundName: i < 2 ? "TREASURE " + tier : null })),
  },
};
