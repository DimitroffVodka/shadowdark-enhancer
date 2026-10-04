// Audit fixture: Carousing, embedded in the Party sheet's Travel tab as PartyApp embeds it. state = setup | complete (add -full for a tall window)
import { renderTemplate, inParty, asActivity } from "./_audit-embed.mjs";
const names = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"];
const ctxFor = (state, setup, complete) => {
  const rows = names.map((name, i) => ({ uuid: "Actor." + name, name, participate: i !== 3, editable: setup, confirmed: i < 2, status: i < 2 ? "Confirmed" : "Not confirmed",
    tiers: [["Wealthy", 50, 3], ["Comfortable", 20, 1], ["Poor", 5, 0]].map(([d, c, b], k) => ({ id: "t" + k, label: `${d} - ${c} gp per PC; roll bonus ${b}`, selected: k === i % 3 })),
    garbQuestions: [{ key: "mask", label: "Wearing a mask for the Festival of Lanterns", checked: i === 0, required: true }, { key: "lantern", label: "Carrying a paper lantern", checked: false }],
    result: complete ? { total: 11 + i, description: "You wake in a barn beside a goat wearing your hat.", benefit: "A friendly rival offers you a favour; gain 1 renown." } : null }));
  return {
    title: "The Lantern Guild", rows, error: setup ? "The tier table could not be read." : null, manager: true, isGM: true, overlap: false, empty: false, setup, complete, resume: false, phase: state,
    holiday: "Festival of Lanterns", manualHoliday: true, canConfigure: true, missingTables: false, config: { place: "Harwick Vale" },
    events: [{ uuid: "e1", name: "Carousing Events", selected: true }, { uuid: "e2", name: "Harwick Events" }], outcomes: [{ uuid: "o1", name: "Carousing Outcomes", selected: true }],
    settlements: ["No settlement", "Village", "Town", "City", "City-state"].map((label, k) => ({ value: label, label, selected: k === 2 })),
    history: [1, 2, 3].map((n) => ({ date: "3 Brewmonth, year 12" + n, logId: "l" + n, historyOnly: n === 3, entries: names.slice(0, 3).map((a) => ({ actorName: a, cost: "20 gp", outcome: "A night best forgotten.", benefit: "+1 renown" })) })),
};
};
export const context = (state) => ctxFor(state, state === "setup", state === "complete");
const build = (state) => {
  const full = state.endsWith("-full"); state = state.replace("-full", "");
  const setup = state === "setup", complete = state === "complete";
  const html = asActivity(renderTemplate("templates/carousing/carousing.hbs", ctxFor(state, setup, complete)));
  return { ...inParty("gm.travel", { activityHTML: html, carousingActive: true, campingActive: false }), height: full ? 2800 : 650 };
};
export default { previewHeight: 900, initial: "setup", build, toolbar: "", actions: {}, title: "The Lantern Guild", icon: "fa-solid fa-users", classes: ["shadowdark", "sheet", "party", "sde-party", "sde-ui"], resizable: true, width: 750, height: 650, template: "templates/party/party.hbs" };
