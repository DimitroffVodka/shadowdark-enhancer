// Party XP: an item dropped in (XP from the item), six awardees, long names, a label typed. state: item | drop (nothing
// dropped yet) | noparty. Context shape is PartyXpApp._prepareContext's. Real window: 460 wide, height auto.
const party = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Supercalifragilisticexpialidocious_Longsword_of_Unbreakingness_Plus_Three", "Martin Rast", "Bartholomew the Unfortunate Wanderer of the Seven Spires"].map((name, i) => ({ id: "p" + i, name, level: i % 4 + 1, xp: i * 3, checked: i !== 4 }));
const build = (s) => ({ context: { amount: s === "item" ? 6 : "", label: s === "item" ? "Disarmed the pit trap in the Sunken Temple" : "", xpPerLevel: 10, item: { img: "/icons/svg/item-bag.svg", name: "Idol of the Drowned Queen", xp: 6 }, hasItem: s === "item", saveToItem: true, itemSourceLabel: "from the item's XP flag",
  hasParty: s !== "noparty", party: s === "noparty" ? [] : party } });
export default {
  title: "SDE.partyXp.title", icon: "fas fa-star", classes: [], resizable: true, width: 460, template: "templates/party-xp.hbs", initial: "item", build,
  toolbar: `<span>State:</span>${["item", "drop", "noparty"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`, actions: { s: { state: "{state}" } },
};
