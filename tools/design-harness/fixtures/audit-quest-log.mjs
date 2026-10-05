// Audit fixture: Quest Log standalone window (Alt+Q). state = gm | player
const quests = [
  ["The Missing Caravan of Harwick Vale and the Lost Merchant's Debt", "GM", 2, 4], ["Rumor: the well is singing", "Rumor", 0, 0], ["Trouble at Saltmarsh Crossing", "Trouble", 1, 3],
  ["Climb the Singing Cliff", "Trainer", 0, 1], ["Deliver the letter", "GM", 1, 1], ["Find the lost shrine in the Bastion Mountains", "GM", 0, 5], ["Clear the cellar", "GM", 3, 3],
].map(([name, sourceLabel, done, total], i) => ({ id: "q" + i, name, selected: i === 0, sourceLabel, progress: { done, total } }));
const build = (state) => {
  const gm = state !== "player";
  return { context: {
    isGM: gm, inline: false, payoutHTML: "", hasParties: true,
    tabs: [["hidden", "Hidden", 2], ["available", "Available", 3], ["active", "Active", 7], ["completed", "Completed", 12], ["failed", "Failed", 1]].filter(([s]) => gm || s !== "hidden").map(([status, label, count]) => ({ status, label, count, active: status === "active" })),
    filterCharacters: ["Creeg Greythorn", "Elbin Grizzlegut"].map((name, i) => ({ uuid: "c" + i, name })), filterParties: [{ uuid: "p", name: "The Lantern Guild" }],
    filterSources: ["GM", "Rumor", "Trouble", "Trainer"].map((label, i) => ({ kind: "k" + i, label })), quests,
    quest: {
      id: "q0", name: quests[0].name, statusLabel: "Active", sourceLabel: "GM", source: { uuid: "JournalEntry.x" }, hasPin: true,
      statusOptions: ["Hidden", "Available", "Active", "Completed", "Failed"].map((label) => ({ value: label, label, selected: label === "Active" })),
      characterList: ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"].map((name, i) => ({ uuid: "c" + i, name })),
      addableCharacters: [{ uuid: "z", name: "Bram" }], partyName: "The Lantern Guild", partyOptions: [{ uuid: "p", name: "The Lantern Guild", selected: true }],
      description: "A caravan of eleven wagons left Harwick Vale three weeks ago and has not arrived. Its owner owes money to people who do not forgive.", descriptionHtml: "<p>A caravan of eleven wagons left Harwick Vale three weeks ago and has not arrived.</p><p>Its owner owes money to people who do not forgive.</p>",
      progress: { done: 2, total: 4 },
      objectives: [["Find the first wagon", true], ["Question the survivors at the mill", true], ["Recover the strongbox from the ruined tollhouse beyond the river", false], ["Return to Harwick Vale", false]].map(([text, done], i) => ({ id: "o" + i, text, done })),
      rewards: { xp: 3, coins: { gp: 150 }, renown: 2, items: [{ img: "/icons/svg/sword.svg", name: "Merchant's ring of seals" }, { img: "/icons/svg/shield.svg", name: "Caravan guard's shield" }], training: null },
      hasRewards: true, coinRewards: ["150 gp"], renownSigned: "+2", trainerName: "", trainerOptions: [{ key: "yodeling", label: "Yodeling - Clementine" }], paid: false, hex: 214,
    },
  } };
};
export default { previewHeight: 700, title: "SDE.quests.title", icon: "fa-solid fa-list-check", classes: ["shadowdark", "sde-quest-log", "sde-ui"], width: 780, height: 620, resizable: true,
  template: "templates/quest-log.hbs", initial: "gm", build, toolbar: `<button data-action="v" data-state="gm">GM</button><button data-action="v" data-state="player">player</button>`, actions: { v: { state: "{state}" } } };
