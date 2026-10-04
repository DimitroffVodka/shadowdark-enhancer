// The real Warband sheet template (ApplicationV2 at runtime, WarbandSheet): the Mount's stat block (shared partials in
// templates/actors/npc-stat/) plus the Warband tab. The harness runs no module JS, so only the actions listed below respond.
// The busiest state a GM can reach: a commander, a full allowance, four upgrades, a garrison with both buildings, arrears,
// a retraining line, and the deserted and routed alerts together.
//   state: <tab> = that tab open (stats | warband | spells | notes | effects); "warband.empty" = no commander, nothing owed.
const TABS = [["stats", "Abilities"], ["warband", "Warband"], ["spells", "Spells"], ["notes", "Description"], ["effects", "Effects"]];
const attack = (id, text) => `<a class="rollable" data-action="item-attack" data-item-id="${id}"><i class="fas fa-dice-d20"></i> <b style="font-size:16px">${text}</b></a>`;
const UPGRADES = ["Accurate", "Ambush", "Armor Upgrade", "Battering Ram", "Camouflage", "Fast", "Hardy", "Loyal", "Phalanx", "Scout", "Siege", "Stealthy", "Tough", "Training", "Trap", "Warcry", "Weapons Upgrade", "Withdraw"];
const abilities = [["str", "STR", 2], ["int", "INT", 0], ["dex", "DEX", 1], ["wis", "WIS", 0], ["con", "CON", 2], ["cha", "CHA", 1]].map(([key, label, mod]) => ({ key, label, mod }));
const full = {
  commander: { uuid: "Actor.cmd", name: "Brenna Ashdown the Younger", img: "/icons/svg/mystery-man.svg" }, commanderMissing: false, tier: "d8 or larger hit die",
  morale: "Morale checks use the commander's CHA: +1",
  allowance: { warbands: "Warbands: 2 of 6", upgrades: "Upgrades: 4 of 4" }, noCommanderCap: null,
  upgrades: UPGRADES.map((label, i) => ({ key: "u" + i, label, checked: [2, 8, 12, 14].includes(i), tip: "Hover text for " + label })),
  textMissing: true, upkeep: "Upkeep: 40 gp a month, from the commander's coins.",
  bastions: [{ uuid: "Actor.b", name: "Ashdown Keep", selected: true }, { uuid: "Actor.b2", name: "The Lantern Hold", selected: false }], garrisonMissing: false,
  garrisonLines: ["Ashdown Keep's Granary: costs 10 gp less a month.", "Ashdown Keep's Barracks: heals 1d6 more a day."],
  arrears: "In arrears: 80 gp owed. It checks morale each week until paid.", deserted: true, retraining: "Retraining its upgrades until Day 14 of Harvest: it can't fight until then.",
  isGM: true, leading: true, routed: true, outOfService: true,
};
const empty = {
  ...full, commander: null, tier: null, morale: null, allowance: null, noCommanderCap: "No commander hit die to go by: at most 4 upgrades. A commander's hit die sets the limit.",
  upgrades: full.upgrades.map((u) => ({ ...u, checked: false })), textMissing: false, bastions: full.bastions.map((b) => ({ ...b, selected: false })), garrisonLines: [],
  arrears: null, deserted: false, retraining: null, leading: false, routed: false, outOfService: false,
};
const build = (state) => {
  const [tab, mode] = (state ?? "warband").split(".");
  return {
    context: {
      actor: { name: "The Ashdown Spears", img: "/icons/svg/mystery-man.svg" }, owner: true, editable: true,
      system: { attributes: { hp: { value: 24, max: 32 }, ac: { value: 14 } }, level: { value: 4 }, moveNote: "", darkAdapted: false, notes: "", spellcasting: { attacks: 0, bonus: 0 } },
      tabs: TABS.map(([id, label]) => ({ id, label, active: id === tab })), tab: Object.fromEntries(TABS.map(([id]) => [id, id === tab])),
      moves: [["near", "Near"], ["doubleNear", "Double near"], ["far", "Far"]].map(([value, label]) => ({ value, label, selected: value === "near" })),
      alignments: [["lawful", "Lawful"], ["neutral", "Neutral"], ["chaotic", "Chaotic"]].map(([value, label]) => ({ value, label, selected: value === "lawful" })),
      castingAbilities: [["wis", "Wisdom"], ["int", "Intelligence"]].map(([value, label]) => ({ value, label, selected: false })),
      warbandAbilities: abilities,
      attacks: [{ itemId: "a1", display: attack("a1", "2 Spear (close) +3 (1d8)") }], specials: [{ itemId: "s1", display: attack("s1", "1 Shield wall (close)") }],
      features: [{ itemId: "f1", name: "Phalanx", description: "<p>Allies in close have advantage on AC checks.</p>" }],
      spells: [], effects: [{ label: "Effects", items: [] }, { label: "Conditions", items: [] }], activeEffects: [], predefinedEffects: [{ key: "blessed", name: "Blessed" }],
      enrichedNotes: "<p>Raised in the Ashdown valley.</p>",
      warband: mode === "empty" ? empty : full,
    },
    toolbar: `<span>State:</span>${TABS.map(([id]) => `<button data-action="changeTab" data-tab="${id}">${id}</button>`).join("")}<button data-action="changeTab" data-tab="warband.empty">warband, empty</button>`,
  };
};
export default {
  previewHeight: 840, title: "The Ashdown Spears", icon: "fa-solid fa-people-group", classes: ["shadowdark", "sheet", "shadowdark-enhancer", "sde-vehicle-sheet", "sde-npc-sheet", "sde-warband-npc"],
  width: 620, height: 780, resizable: true, template: "templates/actors/warband-sheet.hbs", initial: "warband", build,
  actions: { changeTab: { state: "{tab}" } },
};
