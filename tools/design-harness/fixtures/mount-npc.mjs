// The real mount sheet template (ApplicationV2 at runtime; the harness runs no module JS, so only the actions listed
// below respond). A warhorse with CON damage, two riders, gear, a spell and effects: the busiest state a GM can reach.
//   state: <tab> = that tab open, "stats.edit" = the Stats box pencil toggled (inputs for the base scores).
const abilities = [["str", "STR", 16, 16, 3, 0], ["int", "INT", 4, 4, -3, 0], ["dex", "DEX", 12, 12, 1, 0], ["wis", "WIS", 12, 12, 1, 0], ["con", "CON", 14, 12, 1, 2], ["cha", "CHA", 10, 10, 0, 0]]
  .map(([key, label, base, value, mod, damage]) => ({ key, label, base, value, mod, damage }));
const TABS = [["stats", "Abilities"], ["riders", "Riders"], ["gear", "Inventory"], ["mount", "Mount"], ["spells", "Spells"], ["notes", "Description"], ["effects", "Effects"]];
const attack = (id, text) => `<a class="rollable" data-action="item-attack" data-item-id="${id}"><i class="fas fa-dice-d20"></i> <b style="font-size:16px">${text}</b></a>`;
const rider = (name, sub, hp, ac, lvl, a) => ({ uuid: "Actor." + name, name, img: "/icons/svg/mystery-man.svg", subtitle: sub, hp: { value: hp, max: hp }, ac, level: lvl, abilities: a });
const build = (state) => {
  const [tab, mode] = (state ?? "stats").split(".");
  return {
    context: {
      actor: { name: "Warhorse", img: "/icons/svg/mystery-man.svg" }, owner: true, editable: true, editingStats: mode === "edit",
      system: { attributes: { hp: { value: 13, max: 13 }, ac: { value: 11 } }, level: { value: 2 }, moveNote: "", darkAdapted: false, notes: "", spellcasting: { attacks: 1, bonus: 2 } },
      mount: { rarity: "common", personality: "good", trained: true, properties: { sturdy: true }, tack: { saddle: true }, feeding: { daysSinceFood: 2, daysSinceWater: 3 }, pushing: { consecutiveDays: 1 } },
      tabs: TABS.map(([id, label]) => ({ id, label, active: id === tab, count: id === "riders" ? 2 : 0 })), tab: Object.fromEntries(TABS.map(([id]) => [id, id === tab])),
      moves: [["near", "Near"], ["doubleNear", "Double near"], ["far", "Far"]].map(([value, label]) => ({ value, label, selected: value === "doubleNear" })),
      alignments: [["lawful", "Lawful"], ["neutral", "Neutral"], ["chaotic", "Chaotic"]].map(([value, label]) => ({ value, label, selected: value === "neutral" })),
      castingAbilities: [["wis", "Wisdom"], ["int", "Intelligence"]].map(([value, label]) => ({ value, label, selected: value === "wis" })),
      mountAbilities: abilities,
      attacks: [{ itemId: "a1", display: attack("a1", "2 Hooves (close) +2 (1d6)") }, { itemId: "a2", display: attack("a2", "1 Bite (close) (1d4)") }],
      specials: [{ itemId: "s1", display: attack("s1", "1 Trample (close) +1 (1d8 + knockdown)") }],
      features: [{ itemId: "f1", name: "Sure-footed", description: "<p>Advantage on checks to keep its footing on rough ground.</p>" }],
      occupants: [rider("Brenna Ashdown", "Fighter", 14, 15, 3, { str: "+2", dex: "+1", con: "+2", int: "+0", wis: "+0", cha: "-1" }), rider("Tamsin", "Thief", 6, 12, 2, { str: "+0", dex: "+3", con: "+0", int: "+1", wis: "+1", cha: "+2" })], occupantCount: 2,
      inventory: [{ id: "i1", name: "Saddlebags", img: "/icons/svg/item-bag.svg", quantity: 1, slots: 1 }, { id: "i2", name: "Rations", img: "/icons/svg/item-bag.svg", quantity: 6, slots: 2 }],
      derived: { gearSlotsMax: 20, slotsUsed: 3, riderSlots: 20, slotsTotal: 23, attackBonus: 1, pushHexesPerDay: 1, needsTraining: false, thirstDanger: true, starveDanger: false },
      choices: {
        rarities: ["common", "uncommon", "rare", "legendary"].map((v) => ({ value: v, label: v, selected: v === "common" })),
        personalities: ["horrid", "bad", "neutral", "good", "lovely"].map((v) => ({ value: v, label: v, selected: v === "good" })),
        bloodTypes: ["warm", "cold"].map((v) => ({ value: v, label: v, selected: v === "warm" })),
      },
      stabling: { bastions: [{ uuid: "Actor.b", name: "Ashdown Keep", selected: true }], missing: false, line: "Stabled at Ashdown Keep: no grazing or rations needed." },
      npcChoices: [{ uuid: "Actor.n1", name: "Horse (riding)" }, { uuid: "Actor.n2", name: "Pony" }],
      spells: [{ id: "sp1", uuid: "Item.sp1", name: "Cure Wounds", img: "/icons/svg/heal.svg", lost: false, dc: 12, focus: false, duration: "Instant", range: "Close", description: "<p>Heals 1d6 hit points.</p>" }],
      effects: [{ label: "Effects", items: [{ id: "e1", uuid: "Item.e1", name: "Lantern light", img: "/icons/svg/light.svg", unlimited: false }] }, { label: "Conditions", items: [] }],
      activeEffects: [{ uuid: "ActiveEffect.1", name: "Haste", img: "/icons/svg/wing.svg", source: "Warhorse", duration: "3 rounds", unlimited: false, disabled: false, situational: false }, { uuid: "ActiveEffect.2", name: "Blessing of the road", img: "/icons/svg/sun.svg", source: "Warhorse", duration: "", unlimited: true, disabled: false, situational: false }, { uuid: "ActiveEffect.3", name: "Until the next rest", img: "/icons/svg/sleep.svg", source: "Warhorse", duration: "", unlimited: false, disabled: false, situational: true }],
      predefinedEffects: [{ key: "blessed", name: "Blessed" }], enrichedNotes: "<p>Bred in the Western Reaches.</p>",
    },
    toolbar: `<span>State:</span>${TABS.map(([id]) => `<button data-action="changeTab" data-tab="${id}">${id}</button>`).join("")}<button data-action="toggleEditStats">pencil</button>`,
  };
};
export default {
  previewHeight: 840, title: "Warhorse", icon: "fa-solid fa-horse", classes: ["shadowdark", "sheet", "shadowdark-enhancer", "sde-vehicle-sheet", "sde-npc-sheet", "sde-mount-npc"],
  width: 620, height: 780, resizable: true, template: "templates/actors/mount-sheet.hbs", initial: "stats", build,
  actions: { changeTab: { state: "{tab}" }, toggleEditStats: { toggle: ["stats", "stats.edit"] } },
};
