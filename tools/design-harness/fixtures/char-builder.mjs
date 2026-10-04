// The Shadowdark Character Builder (ApplicationV2 at runtime), one state per step, in the busiest shape each can reach.
// The step bodies are partials the module registers by short names (sde-cb-*) at runtime; the harness registers only
// path-named partials, so the fixture writes a scratch copy of char-builder.hbs per step with the step's template spliced
// in and the short names turned into paths. Step contexts are hand-built to the shape each Step.prepareContext returns
// (the real steps read compendiums, which this harness has none of); ability labels and info text are the real constants.
//   state: stats | stats.pointbuy | ancestry | origins | class | hp | gear | preview
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ABILITY_ORDER, ABILITY_LABELS, ABILITY_INFO } from "../../../scripts/char-builder/constants.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRATCH = "/tmp/claude-1000/-home-patricks-git-shadowdark-enhancer/d0efba86-ed4a-4173-b027-7af1159d99a1/scratchpad/tpl";
mkdirSync(SCRATCH, { recursive: true });
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
const P = `modules/shadowdark-enhancer/templates/char-builder/`;
const fixPartials = (s) => s.replace(/\{\{>\s*sde-cb-list/g, `{{> ${P}partials/list.hbs`).replace(/\{\{>\s*sde-cb-([\w-]+)/g, (m, n) => `{{> ${P}steps/${n}.hbs`);
const frame = read("templates/char-builder/char-builder.hbs");
const stepFile = { stats: "stats", ancestry: "ancestry", origins: "origins", class: "class", hp: "hp-gold", gear: "gear", preview: "preview" };
const flatFor = (id) => {
  const f = path.join(SCRATCH, `char-builder-${id}.hbs`);
  writeFileSync(f, frame.replace("{{> (lookup . 'stepPartial') }}", fixPartials(read(`templates/char-builder/steps/${stepFile[id]}.hbs`))));
  return path.relative(ROOT, f);
};
const STEPS = [["stats", "SDE.charBuilder.step.stats"], ["ancestry", "SDE.charBuilder.step.ancestry"], ["origins", "SDE.charBuilder.step.origins"], ["class", "SDE.charBuilder.step.class"], ["hp", "SDE.charBuilder.step.hpGold"], ["gear", "SDE.charBuilder.step.gear"], ["preview", "SDE.charBuilder.step.preview"]];
const en = JSON.parse(readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));
const say = (k) => en[k] ?? k;

const entries = (names, sel, img = "/icons/svg/mystery-man.svg") => names.map((name, i) => ({ id: "u" + i, name, img, selected: name === sel }));
const lorem = "<p>Dwarves are short, stocky folk who live under mountains. They are famously tough and stubborn, and fond of gold, ale and holding a grudge. A dwarf who has given an oath will keep it for a hundred years.</p><p>Second paragraph of the description to show how long body text sets against the list column.</p>";
const mod = (n) => (n >= 0 ? "+" : "") + n;

const stats = (mode) => {
  const vals = { str: 14, dex: 10, con: 15, int: 7, wis: 12, cha: 9 };
  const pb = mode === "pointbuy";
  return { methodLabel: pb ? "Point buy" : "Roll 3d6, assign to taste", isAssign: !pb, isFixed: false, isPointBuy: pb, isManual: false, rolled: true, total: 67, spent: 22, remaining: 6, pointBuyBudget: 28, abilities: ABILITY_ORDER.map((k) => ({ key: k, label: ABILITY_LABELS[k], value: vals[k], mod: mod(Math.floor((vals[k] - 10) / 2)), empty: false, isAssign: !pb, pointBuy: pb, manual: false, pointBuyCost: pb ? 3 : null, canIncrease: true, canDecrease: true, info: ABILITY_INFO[k] })),
    poolChips: pb ? [] : [14, 10, 15, 7, 12, 9].map((value, idx) => ({ idx, value, used: true, picked: false })), showReroll: true, canReroll: false, showReset: true, rollLocked: false, complete: true };
};
const ancestry = () => ({ list: { entries: entries(["Dwarf", "Elf", "Goblin", "Half-Orc", "Halfling", "Human", "Aasimar", "Dragonborn", "Tiefling", "Gnome"], "Dwarf"), search: "", placeholder: "Search ancestries", noThumbs: false, noSearch: false, readOnly: false }, readOnly: false,
  detail: { name: "Dwarf", img: "/icons/svg/mystery-man.svg", description: lorem, hasPortrait: true }, hasSelection: true,
  aside: { traits: [{ uuid: "t1", name: "Stout", descInline: "Start with +2 HP. Roll your hit points per level with advantage.", selected: true }, { uuid: "t2", name: "Darkvision", descInline: "You can see in the dark up to near distance.", selected: false }], needsTalentChoice: false, talentChoiceCount: 0, languageText: "Dwarves know Common and Dwarvish plus one rare language of their choice." },
  charName: "Brenna Ashdown the Younger", trinket: "A rusted key that fits no lock", canRollName: true, canRollTrinket: true, lockedName: { id: "locked::x", pages: "p.14" }, lockedTrinket: null,
  nameOptions: ["Brenna", "Dagna", "Helga", "Kili"].map((v) => ({ value: v, label: v, selected: false })), trinketOptions: ["A rusted key", "A bent coin"].map((v) => ({ value: v, label: v, selected: false })) });
const origins = () => ({ alignment: { suggestedLabel: "Lawful", currentTitle: "Knight Errant", className: "Fighter", options: ["lawful", "neutral", "chaotic"].map((key, i) => ({ key, label: key[0].toUpperCase() + key.slice(1), selected: i === 0, suggested: i === 0, title: i === 0 ? "Knight Errant" : "", desc: "Lawful characters value order, honesty and keeping their word, and work to protect the weak." })) },
  background: { list: { entries: entries(["Urchin", "Wanted", "Cult Initiate", "Thieves' Guild", "Banished", "Orphaned", "Wizard's Apprentice", "Jeweler", "Herbalist", "Barbarian", "Mercenary", "Sailor"], "Sailor"), search: "", placeholder: "Search backgrounds", noThumbs: true, noSearch: false }, hasSelection: true, detail: { name: "Sailor", description: "<p>You have sailed the Inner Sea and know a rope from a rope. You can tie a knot that holds.</p>" } },
  deity: { list: { entries: entries(["Gede", "Ord", "Memnon", "Saint Terragnis", "Shune the Vile", "Madeera the Covenant", "Ramlaat"], "Ord"), search: "", placeholder: "Search deities", noThumbs: true, noSearch: false }, hasSelection: true, detail: { name: "Ord", description: "<p>Ord is the god of knowledge and the keeper of secrets, demanding order from his priests.</p>" }, aside: { alignment: "Lawful", matchesChar: false }, fixedDeity: false } });
const klass = () => ({ list: { entries: entries(["Fighter", "Priest", "Thief", "Wizard", "Ranger", "Warlock", "Bard", "Witch", "Seer", "Knight of St. Ydris"], "Wizard"), search: "", placeholder: "Search classes", noThumbs: false, noSearch: false, readOnly: false }, readOnly: false, hasSelection: true,
  detail: { name: "Wizard", img: "/icons/svg/mystery-man.svg", description: lorem, hasPortrait: true },
  infoLines: [["Hit points", "1d4 per level"], ["Weapons", "dagger, staff"], ["Armor", "none"], ["Languages", "Common, plus two others of your choice"], ["Spellcasting ability", "INT"]].map(([label, value]) => ({ label, value })),
  traits: [{ name: "Spellcasting", descInline: "You can cast wizard spells you know, using INT as your spellcasting ability.", asksOnCreate: false }, { name: "Learning Spells", descInline: "You can permanently learn a wizard spell from a spell scroll.", asksOnCreate: false }, { name: "Weapon Mastery", descInline: "Choose one type of weapon.", asksOnCreate: true }],
  choices: [{ key: "wm", talentName: "Weapon Mastery", chosen: false, options: ["Dagger", "Staff"].map((l) => ({ slug: l, label: l, selected: false })) }],
  bonusRolls: [{ key: "corr", label: "Corruption", tableName: "Wyrd Corruption", rolled: true, duplicate: false, canReroll: true, total: 7, needsChoice: false, options: [], chosenName: "Black Tongue", chosenDesc: "<p>Your tongue blackens; you speak with a rasp.</p>", textResult: null }],
  talent: { hasTable: true, table: [["2", "Gain advantage on initiating one spell"], ["3-6", "Make one random magic item"], ["7-9", "+1 to spellcasting checks"], ["10-11", "+2 to Intelligence or distribute +2 points"], ["12", "Choose a talent or +2 points to stats"]].map(([range, outcome]) => ({ range, outcome })), rolled: true, canRoll: true, total: 8, needsChoice: false, options: [], chosenName: "+1 to spellcasting checks", textResult: null },
  spells: { caster: true, ability: "INT", tiers: [{ tier: 1, count: 3, chosen: 2, full: false, options: ["Alarm", "Burning Hands", "Charm Person", "Detect Magic", "Feather Fall", "Floating Disk", "Hold Portal", "Light", "Magic Missile", "Protection from Evil", "Sleep"].map((name, i) => ({ uuid: "s" + i, name, selected: i < 2, expanded: i === 1, detail: i === 1 ? { tier: 1, range: "Near", duration: "Instant", description: "<p>You hurl a spray of flame; each creature in a close-sized cone takes 1d6 damage.</p>" } : null })) }, { tier: 2, count: 1, chosen: 0, full: false, options: ["Acid Arrow", "Alter Self", "Detect Thoughts", "Fixed Object", "Hold Person"].map((name, i) => ({ uuid: "s2" + i, name, selected: false, expanded: false })) }] },
  patron: { required: true, startingBoons: 1, options: ["Titania", "Kytheros", "Mugdulblub", "Shune the Vile"].map((name, i) => ({ uuid: "p" + i, name, selected: i === 1 })), chosenName: "Kytheros" },
  languages: { readOnly: false, fixed: [{ name: "Common" }, { name: "Dwarvish" }], categories: [{ key: "common", labelKey: "SDE.charBuilder.languages.common", need: 1, chosenCount: 1, full: true, options: ["Elvish", "Giant", "Goblin", "Merran", "Orcish", "Reptilian", "Sylvan", "Thanian"].map((name, i) => ({ uuid: "l" + i, name, selected: i === 1, disabled: i !== 1 })) }, { key: "rare", labelKey: "SDE.charBuilder.languages.rare", need: 1, chosenCount: 0, full: false, options: ["Celestial", "Diabolic", "Draconic", "Primordial"].map((name, i) => ({ uuid: "r" + i, name, selected: false, disabled: false })) }], noChoices: false } });
const hp = () => ({ hp: { hasClass: true, hitDie: "1d4", conModLabel: "+2", hpBonus: 2, advantage: true, maxSetting: true, rollLocked: false, hp: 9, rolled: 9, level: 3, multiLevel: true, diceLabel: "2, 3, 2", complete: true },
  gold: { fixed: null, canEdit: true, rollLocked: false, gp: 60, rolled: true, complete: true } });
const gear = () => ({ categories: [["Weapon", "Weapons"], ["Armor", "Armor"], ["Basic", "Basic"]].map(([key, label], i) => ({ key, label, active: i === 2 })),
  list: { entries: entries(["Backpack", "Caltrops", "Crowbar", "Flask of oil", "Flint and steel", "Grappling hook", "Iron spikes", "Lantern", "Mirror", "Pole", "Rations", "Rope, 60'", "Torch"], "Rope, 60'"), search: "", placeholder: "Search gear" },
  detail: { name: "Rope, 60'", img: "/icons/svg/item-bag.svg", description: "<p>Sixty feet of hempen rope. Holds one person's weight.</p>", type: "Basic", cost: "1 gp", stats: [{ label: "Range", value: "Close" }], slots: 1, magic: false, inCart: 1 }, hasSelection: true,
  cart: [["Backpack", 1], ["Torch", 4], ["Rations", 3], ["Rope, 60'", 1], ["Flask of oil", 2], ["Dagger", 1]].map(([name, qty], i) => ({ key: "k" + i, name, qty, magic: i === 5 })), cartEmpty: false, slotsUsed: 9, slotLimit: 10, overSlots: false, remaining: "12 gp 5 sp", overBudget: false, gold: "60 gp" });
const preview = () => ({ name: "Brenna Ashdown the Younger", ancestry: "Dwarf", class: "Wizard", background: "Sailor", deity: "Ord", alignment: "Lawful", trinket: "A rusted key that fits no lock", patron: "Kytheros",
  abilities: ABILITY_ORDER.map((k, i) => ({ key: k.toUpperCase(), value: [14, 10, 15, 7, 12, 9][i], mod: mod(Math.floor(([14, 10, 15, 7, 12, 9][i] - 10) / 2)) })), level: 3, hp: 9, goldRolled: "60 gp", coinsAfter: "12 gp 5 sp", languages: ["Common", "Dwarvish", "Giant"], talents: ["Stout", "Spellcasting", "+1 to spellcasting checks"],
  spells: [{ name: "Burning Hands", tier: 1 }, { name: "Alarm", tier: 1 }, { name: "Acid Arrow", tier: 2 }], gear: [["Backpack", 1], ["Torch", 4], ["Rations", 3], ["Rope, 60'", 1]].map(([name, qty]) => ({ name, qty })), kept: null,
  art: { portrait: "x", token: null, portraitSrc: "/icons/svg/mystery-man.svg", tokenSrc: "/icons/svg/mystery-man.svg", portraitIsSuggested: true, canSuggest: true, canPickFiles: true, canGallery: true, any: true, lightOnly: false }, ready: false, missing: ["Hit Points", "Gear"] });

const build = (state) => {
  const [id, mode] = (state ?? "class").split(".");
  const ctx = { stats, ancestry, origins, class: klass, hp, gear, preview }[id](mode);
  return { template: flatFor(id), context: { steps: STEPS.map(([sid, label], i) => ({ id: sid, label: say(label), icon: "", active: sid === id, complete: i % 2 === 0 && sid !== id, index: i, num: i + 1 })), stepId: id, step: ctx,
    nav: { canPrev: id !== "stats", isLast: id === "preview", supportsRandom: true, showFullRandom: id === "stats", allComplete: false, existing: false, finishing: false, canUndo: false, levelUpOffer: null, levelUpActive: null, level: { value: 3, options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, selected: i === 2 })) } } },
    toolbar: `<span>Step:</span>${STEPS.map(([sid]) => `<button data-action="cbGoto" data-step="${sid}">${sid}</button>`).join("")}<button data-action="cbGoto" data-step="stats.pointbuy">pointbuy</button>` };
};
export default {
  previewHeight: 800, title: "SDE.charBuilder.title", icon: "fa-solid fa-user-plus", classes: ["shadowdark", "sde-char-builder"],
  width: 1040, height: 780, resizable: true, template: flatFor("class"), initial: "class", build,
  actions: { "cb-goto": { state: "{step}" }, cbGoto: { state: "{step}" } },
};
