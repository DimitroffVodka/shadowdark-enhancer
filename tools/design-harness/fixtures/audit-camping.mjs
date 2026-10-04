// Audit fixture: Camping, embedded in the Party sheet's Travel tab exactly as PartyApp embeds it.
// state = setup | fuel | results   (GM view)
import { renderTemplate, inParty, asActivity } from "./_audit-embed.mjs";
const names = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"];
const sel = (items) => items;
const taskList = (cur) => [["", "No task"], ["battenDown", "Batten down"], ["cook", "Cook"], ["craft", "Craft"], ["entertain", "Entertain"], ["firewood", "Gather firewood"], ["hunt", "Hunt"], ["keepWatch", "Keep watch"], ["predict", "Predict weather"]].map(([key, name]) => ({ key, name, selected: key === cur }));
const rowFor = (name, i, setup, results) => {
  const task = ["craft", "entertain", "keepWatch", "cook", "hunt"][i], fed = i !== 2, tk = { craft: ["Craft", "Make torches, arrows, bolts or sling stones, or repair gear. Needs a campfire."], entertain: ["Entertain", "Lift the spirits of one ally."], keepWatch: ["Keep watch", "Stand a half of the night."], cook: ["Cook", "Make the meal count."], hunt: ["Hunt", "Bring back fresh food."] }[task];
  return {
    uuid: "Actor." + name, actorId: "a" + i, name, partyRations: i % 2 === 0, confirmed: i < 3, participate: true, foodEditable: setup, editable: setup,
    meal: { fed, own: fed ? 2 + (i % 2) : 0, shortfall: fed ? 0 : 2, con: 12, rest: results ? (i !== 2) : null, saved: false },
    foodStatus: fed ? "Fed" : "Unfed", deathWarning: !fed, restStatus: results ? (i !== 2 ? "Rested" : "No rest") : null,
    tasks: taskList(task), abilities: [{ value: "dex", label: "DEX", selected: true }, { value: "int", label: "INT" }], dc: 12, task, taskName: tk[0], description: tk[1],
    campfire: true, torchConsent: true, craftTask: task === "craft", entertainTask: task === "entertain", watchTask: task === "keepWatch", repair: task === "craft",
    outputs: ["Torch", "Arrows", "Bolts", "Sling Stones", "Repair mundane gear"].map((label, k) => ({ value: label, label, selected: k === 4 })),
    repairs: [{ id: "r1", name: "Cracked shield", selected: true }, { id: "r2", name: "Dented helm" }],
    recipients: names.filter((n) => n !== name).map((n) => ({ uuid: "Actor." + n, name: n, selected: n === "Martin Rast" })),
    halves: [{ value: "first", label: "First half", selected: true }, { value: "second", label: "Second half" }],
    result: results ? { total: 9 + i, dc: 12, disadvantage: i === 1, success: i !== 2, amount: i === 0 ? 3 : 0, status: i !== 2 ? "Success" : "Failure", effect: ["Saved", "Pending", "No benefit", "Cook saved; requires eligible fed full rest", "Saved"][i] } : null,
  };
};
const ctxFor = (state, setup, fuel, results) => ({
    title: "The Lantern Guild", manager: true, setup, fuel, isGM: true, error: state === "setup" ? "Martin Rast chose Entertain but has not picked a recipient." : null,
    phase: { setup: "Choose tasks and participation", fuel: "Choose torch fallback; tasks stay locked", results: "Night complete; review saved results" }[state], fire: "Fire lit", hasResults: results,
    awaitingRest: false, complete: results, shortageWarning: false, canNight: false, canResolve: setup, canResume: !setup && !fuel,
    fuelChoices: [["none", "No fire"], ["wood", "Firewood task; offer torches on failure"], ["torches", "Existing torches"]].map(([value, label]) => ({ value, label, selected: value === "torches" })),
    available: 9, canFuel: true, deductions: [{ name: "Creeg Greythorn", item: "Torch", quantity: 2 }, { name: "Jorbin Ironhelm", item: "Torch", quantity: 1 }],
    mounts: [["Dusty", "Mule"], ["Biscuit", "Pony"]].map(([name], i) => ({ uuid: "Actor." + name, name, partyRations: false, foodEditable: setup, meal: { fed: i === 0, own: i === 0 ? 2 : 0, shortfall: i, con: 9 }, foodStatus: i === 0 ? "Fed" : "Unfed", deathWarning: i === 1 })),
    rows: names.map((n, i) => rowFor(n, i, setup, results)),
});
export const context = (state) => {
  const setup = state === "setup", fuel = state === "fuel", results = state === "results";
  return ctxFor(state, setup, fuel, results);
};
const build = (state) => {
  const full = state.endsWith("-full"); state = state.replace("-full", "");
  const setup = state === "setup", fuel = state === "fuel", results = state === "results";
  const html = asActivity(renderTemplate("templates/camping/camping.hbs", ctxFor(state, setup, fuel, results)));
  return { ...inParty("gm.travel", { activityHTML: html }), height: full ? 2600 : 650 };
};
export default { previewHeight: 900, initial: "setup", build, toolbar: "", actions: {}, ...{ title: "The Lantern Guild", icon: "fa-solid fa-users", classes: ["shadowdark", "sheet", "party", "sde-party", "sde-ui"], resizable: true, width: 750, height: 650, template: "templates/party/party.hbs" } };
