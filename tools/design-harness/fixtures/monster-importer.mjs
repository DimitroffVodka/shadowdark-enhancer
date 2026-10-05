// MonsterImporterApp, real template. Audit fixture. state: busy | empty
const mk = (name, i) => ({ idx: i, draft: { name, level: 4, ac: 13, hp: { value: 18, max: 18 }, alignment: "C", move: "near", moveNote: "climb",
  abilities: { str: 2, dex: 1, con: 1, int: -2, wis: 0, cha: -1 }, spellcasting: { ability: "int", bonus: 3, attacks: 1 },
  actions: [{ num: 2, name: "claw", type: "NPC Attack", bonus: 3, damage: "1d6", ranges: ["close"], description: "" }, { num: 1, name: "venomous bite", type: "NPC Special Attack", bonus: 0, damage: "", ranges: ["close", "near"], description: "DC 12 CON or paralyzed for 1d4 rounds" }],
  features: [{ name: "Web Walker", description: "Ignores difficult terrain made of webs and can climb any surface without a check." }] },
  warnings: i === 0 ? ["AC could not be read", "Alignment missing"] : [], hasWarnings: i === 0, warnCount: i === 0 ? 2 : 0, warn: { ac: i === 0, alignment: i === 0 } });
const build = (state) => { const busy = state !== "empty"; const monsters = busy ? ["Giant Cave Spider", "Lamprey Queen of the Drowned Cathedral", "Bone Hound"].map(mk) : []; return { context: {
  text: "", source: "Cursed Scroll 3", sourceSuggestions: ["Core", "CS1"], monsters, hasParsed: busy, total: monsters.length, skipped: busy ? [{ name: "Random Encounters", reason: "table" }] : [], skippedCount: busy ? 1 : 0,
  alignments: ["L", "N", "C"], moveOptions: ["none", "close", "near", "double near", "far"], spellAbilities: [{ value: "", label: "-" }, { value: "int", label: "INT" }, { value: "wis", label: "WIS" }, { value: "cha", label: "CHA" }],
  attackTypes: ["NPC Attack", "NPC Special Attack"], abilityKeys: [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]].map(([key, label]) => ({ key, label })) } }; };
export default { id: "sde-monster-importer", title: "SDE.importer.monsterImporter.title", icon: "fas fa-dragon", classes: ["sde-ui", "sde-imp"], width: 860, height: 780, template: "templates/monster-importer.hbs", initial: "busy", build, resizable: true, actions: {} };
