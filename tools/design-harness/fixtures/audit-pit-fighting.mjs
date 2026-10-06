// Audit fixture: Pit Fighting. Classes mirror the app's DEFAULT_OPTIONS.classes (shadowdark, sde-pit, sde-ui).
// state = fresh | offer | result
const P = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"];
const build = (state) => {
  const fresh = state === "fresh", result = state === "result";
  return { context: {
    hasParty: true, hasVenue: !fresh, hasStakes: !fresh, hasOffer: !fresh, accepted: result, declined: false, undecided: state === "offer",
    apl: 3, aplRounded: true, aplMeanText: "2.6", partySize: 5,
    venueOptions: [["2-3", "A flooded cellar beneath the Salted Anchor"], ["4-5", "The old quarry"], ["6-8", "A fighting pit behind the tannery"], ["9-10", "The Duke's courtyard"], ["11-12", ""]].map(([range, text], i) => ({ total: i + 2, range, text, row: i + 1, selected: i === 2 })),
    stakesOptions: ["Pocket change", "A fair purse", "High stakes: the fighters' lives", "Legendary"].map((label, i) => ({ total: i, label, selected: i === 2 })),
    twistOptions: ["No twist", "The crowd throws rotten fruit", "A second challenger joins mid-bout", "The floor is rigged"].map((text, i) => ({ total: i + 2, range: String(i + 2), text, selected: i === 2 })),
    dangerOptions: ["Easy", "Medium", "Hard", "Deadly"].map((label, i) => ({ key: label, label, selected: i === 2 })),
    group: true, sizeLabel: "Group bout (the whole party)",
    bout: { venue: { total: 7 }, stakes: { total: 9, table: "Pit Prizes", raised: true, label: "High stakes: the fighters' lives" }, twist: { total: 6 }, danger: { overridden: true }, encounterTable: "Pit Fighting Foes (Hard)" },
    venueText: "A fighting pit behind the tannery. Sand floor, a rail of rusted spikes, a crowd of forty shouting for blood.", foeText: "3 ogre brawlers, 1 pit master and 6 giant rats",
    foes: [["3", "Ogre Brawler", "", true], ["1", "Pit Master", "wields a hooked net", true], ["6", "Giant Rat", "", true], ["1", "Chained Troll", "", false]].map(([count, display, note, uuid]) => ({ count, display, note, uuid: uuid ? "Actor.x" : "" })),
    canPlaceFoes: true,
    twistRevealed: result, twistText: "A second challenger joins mid-bout: a masked champion who fights only with a whip.", twistSub: "3", twistIsNone: false,
    missing: ["Pit Fighting Foes (Hard)", "Pit Fighting Twists"], hasMissing: true,
    party: P.map((name, i) => ({ id: "a" + i, name, level: 2 + (i % 3), renown: i * 3 - 1, checked: i !== 4 })), fighterCount: 4,
    prize: result ? "A masterwork short sword, 120 gp and the crowd's favour." : "", outcome: result ? "win" : null, isWin: result, isLoss: false, renownDelta: 2, applied: false, canApply: result,
  } };
};
export default { previewHeight: 900, title: "SDE.pitFighting.title", icon: "fas fa-hand-fist", classes: ["shadowdark", "sde-pit", "sde-ui"], width: 520, template: "templates/pit-fighting.hbs", initial: "offer", build,
  toolbar: ["fresh", "offer", "result"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""), actions: { t: { state: "{state}" } } };
