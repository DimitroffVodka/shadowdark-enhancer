// Magic Forge, three busiest states. state: core (armor in Core mode: three table sets, mixed readiness, base picked),
// scroll (spell picker: tier chips, four open class folders, three picked), weapon (manual mode, long base list).
// Context shape is MagicForgeApp._prepareContext's; icons are the app's TYPE_ICON table.
const types = [["weapon", "Weapon", "fa-gavel"], ["armor", "Armor", "fa-shield-halved"], ["scroll", "Scroll", "fa-scroll"], ["wand", "Wand", "fa-wand-sparkles"]];
const typesFor = (a) => types.map(([id, label, icon]) => ({ id, label, icon, active: id === a }));
const ico = (n) => "/icons/svg/" + n + ".svg";
const bases = ["Longsword", "Shortsword", "Dagger", "Greataxe", "Warhammer", "Crossbow", "Short bow", "Longbow", "Spear", "Mace", "Staff", "Club", "Javelin", "Rapier", "Flail", "Halberd"].map((name) => ({ uuid: "w" + name, name, nameLower: name.toLowerCase(), img: ico("sword") }));
const results = (n) => Array.from({ length: n }, (_, i) => ({ resultId: "r" + i, rangeLabel: i < 6 ? String(i + 1) : "7-8", text: ["Flaming blade that sheds light as a torch", "Whispers warnings when danger is near", "+1 to attack rolls against undead", "Glows faintly in the presence of orcs", "Once per day, deal an extra 1d6 cold damage and the wielder is chilled until dawn", "Cursed: cannot be willingly discarded", "Singing sword, sings off-key", "Bonds to its wielder"][i % 8], selected: i === 4 }));
const fld = (label, roleClass, ready, extra = {}) => ({ manifestId: "m-" + label, label, roleClass, roleLabel: { mechanical: "Mechanical", hint: "Hint", descriptive: "Flavor" }[roleClass], ready, hasSelection: ready && roleClass === "mechanical", selectedText: "Once per day, deal an extra 1d6 cold damage and the wielder is chilled until dawn", perTable: false, results: ready ? results(8) : [], ...extra });
const coreSets = [
  { key: "bonus", label: "Magic Weapon Bonus", perTable: false, ready: true, badge: { cls: "ready", icon: "fa-circle-check", label: "Ready" }, pageLabel: "p. 288", diagnostics: [], fields: [fld("Bonus", "mechanical", true)] },
  { key: "features", label: "Weapon Features, Benefits and Curses", perTable: true, ready: false, badge: { cls: "partial", icon: "fa-circle-half-stroke", label: "Partial" }, pageLabel: "p. 289-291", diagnostics: [{ message: "2 of 5 tables are imported." }],
    fields: [fld("Benefit", "mechanical", true), fld("Curse", "hint", false, { perTable: true }), fld("Personality", "descriptive", false, { perTable: true }), fld("Virtue and flaw", "descriptive", false)] },
  { key: "unique", label: "Unique Item Names and a Very Long Table Heading for Overflow", perTable: false, ready: false, badge: { cls: "locked", icon: "fa-lock", label: "Locked" }, pageLabel: "p. 292", diagnostics: [{ message: "The source PDF has not been read yet. Import the set from the Importer Hub." }], fields: [] },
];
const spell = (name, tier, selected = false) => ({ uuid: "s" + name, name, img: ico("book"), tier, dc: tier + 10, nameLower: name.toLowerCase(), selected });
const spells = { Wizard: ["Magic Missile", "Sleep", "Fireball", "Lightning Bolt", "Polymorph", "Alarm", "Burning Hands", "Charm Person"], Priest: ["Cure Wounds", "Holy Weapon", "Light", "Protection from Evil", "Smite", "Bless"], Warlock: ["Eldritch Blast Variant With Long Name", "Hex"], Other: ["Wild Surge"] };
const groups = Object.entries(spells).map(([className, names]) => ({ className, count: names.length, open: className !== "Other", spells: names.map((n, i) => spell(n, (i % 4) + 1, ["Sleep", "Fireball", "Smite"].includes(n))) }));
const base = { isCore: false, coreAvailable: true, coreSets: [], coreBonusHint: null, typeHint: null, bonus: 1, bonusOptions: [0, 1, 2, 3].map((n) => ({ n, active: n === 1 })), name: "", identified: false, baseSelected: null, bases: [], spellGroups: [], tierChips: [], isGear: true, isSpellItem: false, isWand: false, canForge: false };
const build = (state) => state === "scroll"
  ? { context: { ...base, types: typesFor("scroll"), typeLabel: "Scroll", isGear: false, isSpellItem: true, coreAvailable: false, spellGroups: groups, canForge: false,
      tierChips: [{ label: "All", tier: "all", active: false }, ...[1, 2, 3, 4].map((t) => ({ label: "Tier " + t, tier: t, active: t === 2 }))],
      preview: { icon: "fa-scroll", typeLabel: "Scroll", name: "Scroll of Sleep", lines: ["Sleep (tier 1, DC 11)", "Fireball (tier 3, DC 13)", "Smite (tier 2, DC 12)"] } } }
  : state === "weapon" ? { context: { ...base, types: typesFor("weapon"), typeLabel: "Weapon", bases, coreAvailable: true, preview: { icon: "fa-gavel", typeLabel: "Weapon", name: "Weapon", lines: ["Pick a base item"] } } }
  : { context: { ...base, types: typesFor("armor"), typeLabel: "Armor", isCore: true, coreSets, typeHint: "Plate", coreBonusHint: 2, baseSelected: { name: "Chainmail of the Lantern Hold, Reinforced", img: ico("armor") }, canForge: true,
      preview: { icon: "fa-shield-halved", typeLabel: "Armor", name: "Chainmail of the Lantern Hold, Reinforced +2", lines: ["Base: Chainmail of the Lantern Hold, Reinforced", "+2 magic bonus (from the Core table)", "3 Core rider(s) chosen", "Type hint: Plate"] } } };
export default {
  title: "SDE.magicForge.title", icon: "fas fa-hammer", classes: ["sde-ui", "sde-magicforge"], resizable: true, width: 720, template: "templates/magic-forge.hbs", initial: "core", build,
  toolbar: `<span>State:</span>${["core", "scroll", "weapon"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`, actions: { s: { state: "{state}" } },
};
