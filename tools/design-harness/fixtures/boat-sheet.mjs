// The Boat sheet (ApplicationV2 at runtime) at its busiest: a war galley with captain, gunners, crew, siege weapons,
// cargo, a crew shortage and a sinking countdown.
//   state: <tab> = overview | occupants | inventory | weapons | description

const TABS = ["overview", "occupants", "inventory", "weapons", "description"];
const person = (name, sub, role, hp, ac, lvl, a) => ({ uuid: "Actor." + name, id: name, name, img: "/icons/svg/mystery-man.svg", role, isCaptain: role === "captain", isGunner: role === "gunner", isCrew: role === "crew", isNPC: false, subtitle: sub, hp: { value: hp, max: hp }, ac, level: lvl, abilities: a });
const ab = { str: "+2", dex: "+1", con: "+2", int: "+0", wis: "+0", cha: "-1" };
const occupants = [person("Brenna Ashdown the Younger", "Fighter", "captain", 14, 15, 3, ab), person("Tamsin", "Thief", "gunner", 6, 12, 2, ab), person("Old Harl", "Sailor", "crew", 5, 10, 1, ab), person("Wick", "Priest", "", 9, 13, 2, ab), { uuid: "Actor.gone", broken: true, name: "Missing actor" }];

const build = (state) => {
  const tab = TABS.includes(state) ? state : "overview";
  return {
    context: {
      document: { name: "The Sea Wanderer", img: "/icons/svg/mystery-man.svg" }, editable: true, occupantLabel: "Passengers & Crew",
      tab: Object.fromEntries(TABS.map((t) => [t, t === tab])),
      system: { hp: { value: 18, max: 24 }, ac: 13, speed: 3, cost: 4000, gearSlots: { max: 40 }, crew: { required: 8, current: 4 }, properties: { crew: true, fast: false, rowGalley: true, unseaworthy: false, weapons: true }, propertiesNote: "", sinking: { active: true, roundsRemaining: 3 }, notes: "Bought in Port Vale." },
      derived: { combatSpeedFeet: 30, capacity: 24, crewAboard: 3, repairCost: 60, crewShort: true },
      occupantCount: occupants.length, occupants, captain: occupants[0], gunners: [occupants[1], occupants[3]],
      items: [["Barrels of salt pork", 12, 6], ["Spare sail", 1, 2], ["Grapnel and 100' rope", 2, 1], ["Lamp oil", 8, 1]].map(([name, quantity, slots], i) => ({ id: "i" + i, name, img: "/icons/svg/item-bag.svg", quantity, slots })),
      slotInfo: { used: 10, max: 40, note: "passengers do not use cargo slots" },
      weapons: [{ id: "w1", name: "Ballista", img: "/icons/svg/sword.svg", damage: "3d8", slots: 4 }, { id: "w2", name: "Mounted scorpion", img: "/icons/svg/sword.svg", damage: "2d6", slots: 2 }], weaponCount: 2,
    },
    toolbar: `<span>State:</span>${TABS.map((t) => `<button data-action="changeTab" data-tab="${t}">${t}</button>`).join("")}`,
  };
};
export default {
  previewHeight: 760, title: "The Sea Wanderer", icon: "fa-solid fa-sailboat", classes: ["shadowdark", "sheet", "shadowdark-enhancer", "sde-ui", "sde-parchment", "sde-vehicle-sheet", "sde-boat-sheet"],
  width: 600, height: 720, resizable: true, template: "templates/actors/boat-sheet.hbs", initial: "overview", build,
  actions: { changeTab: { state: "{tab}" } },
};
