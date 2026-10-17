// Audit fixture: Quest Log standalone window (Alt+Q). state = gm | player | playernext | playeravail (an Available quest with the Accept link)
const quests = [
  ["The Missing Caravan of Harwick Vale and the Lost Merchant's Debt", "GM", 3, 8], ["Rumor: the well is singing", "Rumor", 0, 0], ["Trouble at Saltmarsh Crossing", "Trouble", 1, 3],
  ["Climb the Singing Cliff", "Trainer", 0, 1], ["Deliver the letter", "GM", 1, 1], ["Find the lost shrine in the Bastion Mountains", "GM", 0, 5], ["Clear the cellar", "GM", 3, 3],
].map(([name, sourceLabel, done, total], i) => ({ id: "q" + i, name, selected: i === 0, sourceLabel, progress: { done, total } }));
// [text, done, parent index, secret, later (hidden on a "next" quest)]; subRow marks where the open sub-step row sits.
const objectives = [
  ["Find the first wagon", true, null, false, false],
  ["Question the survivors at the mill", true, null, false, false],
  ["Ask the miller about the night of the fire", true, 1, false, false],
  ["Find who paid the miller to stay silent", false, 1, true, false, true],
  ["Recover the strongbox from the ruined tollhouse beyond the river", false, null, false, false],
  ["Check the cellar for the false floor", false, 4, false, true],
  ["The merchant staged the whole robbery", false, null, true, true],
  ["Return to Harwick Vale", false, null, false, true],
].map(([text, done, parent, secret, later, subRow], i, all) => ({
  id: "o" + i, text, done, parent: parent === null ? null : "o" + parent, secret, later: !!later, subRow: !!subRow,
  parentSecret: parent !== null && all[parent][3],
}));
const build = (state) => {
  const gm = state === "gm", avail = state === "playeravail";
  return { context: {
    isGM: gm, inline: false, payoutHTML: "", hasParties: true,
    tabs: [["hidden", "Hidden", 2], ["available", "Available", 3], ["active", "Active", 7], ["completed", "Completed", 12], ["failed", "Failed", 1]].filter(([s]) => gm || s !== "hidden").map(([status, label, count]) => ({ status, label, count, active: status === "active" })),
    filterCharacters: ["Creeg Greythorn", "Elbin Grizzlegut"].map((name, i) => ({ uuid: "c" + i, name })), filterParties: [{ uuid: "p", name: "The Lantern Guild" }],
    filterSources: ["GM", "Rumor", "Trouble", "Trainer"].map((label, i) => ({ kind: "k" + i, label })), quests,
    quest: {
      when: {
        overdue: true,
        dueText: gm ? "" : "Due: 14 March 1348",
        rows: gm ? [
          { field: "startsAt", label: "Appears on", day: "", year: "", set: false, months: ["January", "February", "March"].map((label, i) => ({ value: i + 1, label, selected: false })) },
          { field: "deadline", label: "Deadline", day: 14, year: 1348, set: true, months: ["January", "February", "March"].map((label, i) => ({ value: i + 1, label, selected: i === 2 })) },
        ] : [],
        appearsPassed: false, failPassed: gm,
      },
      whenOpen: true, deadline: 5, autoFail: true,
      id: "q0", name: quests[0].name, statusLabel: avail ? "Available" : "Active", canAccept: avail, sourceLabel: "GM", source: { uuid: "JournalEntry.x" }, hasPin: true,
      statusOptions: ["Hidden", "Available", "Active", "Completed", "Failed"].map((label) => ({ value: label, label, selected: label === "Active" })),
      characterList: ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"].map((name, i) => ({ uuid: "c" + i, name })),
      addableCharacters: [{ uuid: "z", name: "Bram" }], partyName: "The Lantern Guild", partyOptions: [{ uuid: "p", name: "The Lantern Guild", selected: true }],
      description: "A caravan of eleven wagons left Harwick Vale three weeks ago and has not arrived. Its owner owes money to people who do not forgive.", descriptionHtml: "<p>A caravan of eleven wagons left Harwick Vale three weeks ago and has not arrived.</p><p>Its owner owes money to people who do not forgive.</p>",
      progress: state === "playernext" ? { done: 0, total: 0 } : { done: 3, total: gm ? 8 : 6 },
      revealOptions: [["all", "All steps"], ["next", "Only the next step"]].map(([value, label]) => ({ value, label, selected: value === (state === "playernext" ? "next" : "all") })),
      newSecret: true, newSubSecret: false,
      objectives: objectives.filter((o) => gm || (!o.secret && !o.parentSecret)).filter((o) => state !== "playernext" || !o.later),
      rewards: { xp: 3, coins: { gp: 150, sp: 20, cp: 5 }, renown: 2, items: [{ img: "/icons/svg/sword.svg", name: "Merchant's ring of seals" }, { img: "/icons/svg/shield.svg", name: "Caravan guard's shield" }], training: null, notes: ["Free lodging at the lighthouse for a month", "The miller owes you a favour"] },
      giver: { uuid: "Actor.g", name: "Old Maren Vosk", img: "/icons/svg/mystery-man.svg" },
      hasNotes: true, noteList: ["Free lodging at the lighthouse for a month", "The miller owes you a favour"].map((text, index) => ({ text, index })),
      hasRewards: true, showRewards: true, coinRewards: ["150 gp", "20 sp", "5 cp"], renownSigned: "+2", trainerName: "", trainerOptions: [{ key: "yodeling", label: "Yodeling - Clementine" }], paid: false, hex: 214,
    },
  } };
};
export default { previewHeight: 2400, title: "SDE.quests.title", icon: "fa-solid fa-list-check", classes: ["shadowdark", "sde-quest-log", "sde-ui"], width: 780, height: 2300, resizable: true,
  template: "templates/quest-log.hbs", initial: "gm", build, toolbar: `<button data-action="v" data-state="gm">GM</button><button data-action="v" data-state="player">player</button><button data-action="v" data-state="playernext">player (next only)</button><button data-action="v" data-state="playeravail">player (Available)</button>`, actions: { v: { state: "{state}" } } };
