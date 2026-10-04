// Audit fixture: Downtime window, three faces. state = solo | gm | player.  All slot text is invented filler (the real text comes from the GM's own book and is never in the repo).
const P = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"];
const lorem = "Invented placeholder outcome text standing in for what the GM pasted from the book; it runs two or three lines at this width so the layout is tested honestly.";
const slot = (activityKey, i, session, chosen, extra = {}) => ({ key: activityKey + i, activityKey, label: ["Cheap option", "Modest option", "Serious option", "Grand option", "Legendary undertaking"][i], dc: 9 + i * 2, baseDc: 9 + i * 2, stepped: i === 2, statChip: ["INT", "CHA", "DEX"][i % 3], costLabel: ["free", "10 gp", "50 gp", "200 gp", "1,000 gp"][i], outcome: lorem, chosen, inSession: session, pickDisabled: false, disabled: false, canStepDown: true, canStepUp: true, ...extra });
const acts = (session, chosenKey) => [["training", "Training", "INT or WIS"], ["research", "Magical research", "INT"], ["skulduggery", "Skulduggery", "CHA or DEX"], ["craft", "Crafting", "DEX"]].map(([key, name, checkLabel], a) => ({
  key, name, checkLabel, gateNote: a === 1 ? "Needs a spellbook, or a patron willing to share theirs." : "", casterToggle: a === 1 ? { arcane: true, divine: false } : null, tierPicker: a === 0 ? { options: ["Basic", "Trained", "Expert", "Master"].map((label, i) => ({ key: "t" + i, label, selected: i === 1, detected: i === 1 })) } : null,
  choice: a === 3 ? { options: [{ key: "dex", label: "DEX", selected: true }, { key: "int", label: "INT" }] } : null,
  groups: [{ label: a === 1 ? "Learning" : "", enabled: true, reason: "", slots: [0, 1, 2, 3, 4].map((i) => slot(key, i, session, chosenKey === key + i, { unaffordable: i === 4, rowReason: i === 4 ? "Costs 1,000 gp; you have 38 gp." : "", pickDisabled: i === 4, disabled: i === 4 })) }, ...(a === 1 ? [{ label: "Teaching", enabled: false, reason: "Not a caster", slots: [slot(key, 0, session, false)] }] : [])] }));
const base = (state) => {
  const session = state !== "solo", player = state === "player";
  return {
    hasSources: true, anyUnlocked: true, inSession: session, soloMode: !session, isPlayer: player, hasActors: true, hasSteps: true, showStepper: !player,
    sources: [{ slug: "wr", label: "Western Reaches", unlocked: true, selected: true }, { slug: "cs6", label: "Cursed Scroll 6", unlocked: false }],
    lockedSources: player ? [] : [{ slug: "cs6", label: "Cursed Scroll 6", pages: "12-14" }], staleSources: player ? [] : [{ slug: "wr", label: "Western Reaches" }],
    actors: P.map((name, i) => ({ id: "a" + i, name, selected: i === 0 })), advModes: [["normal", "Normal"], ["adv", "Advantage"], ["dis", "Disadvantage"]].map(([key, long], i) => ({ key, long, selected: i === 0 })),
    actorLevel: 3, coins: { gp: 38, sp: 14, cp: 2 }, renown: 12, renownBand: "Known", renownBonus: "+1", renownBandNote: "Folk have heard of you.",
    session: session ? { sourceLabel: "Western Reaches", days: 7, locked: false, pickCount: 3, resultCount: 1 } : null,
    overview: session && !player ? P.map((name, i) => ({ name, actorId: "a" + i, picked: i < 4, pickLabel: ["Serious option (Training)", "Cheap option (Crafting)", "Grand option (Skulduggery)", "Modest option (Magical research)"][i] ?? "", advantage: "Advantage", rolled: i === 0, total: 17, dc: 13, success: true, awaitingChoice: i === 0 })) : null,
    myPick: session && player ? { label: "Serious option", advantage: "Normal" } : null, canRoll: false, rollBlockedReason: session && player ? "Costs 50 gp; you have 38 gp." : "",
    myResult: null,
    result: !session ? { activityName: "Training", label: "Serious option", total: 17, dc: 13, success: true, outcome: lorem, renownDelta: 1, renownSigned: true, xpDelta: 2, targets: P.map((name, i) => ({ id: "a" + i, name, selected: i === 0 })), applied: false } : null,
    activities: acts(session, "training2"),
    recruit: { name: "Recruit a warband", checkLabel: "CHA", settlementLine: "Harwick Vale: a town; supplies up to 2 warbands.", settlementOptions: [{ value: "", label: "From the map", selected: true }, { value: "town", label: "Town" }], blocked: "", none: false,
      offers: [{ id: "w1", key: "rw1", name: "Hill Raiders", level: 2, dc: 12, statChip: "CHA", inSession: session, chosen: false, disabled: false, showReason: false }, { id: "w2", key: "rw2", name: "Hired Pikemen", level: 3, dc: 14, statChip: "CHA", inSession: session, chosen: false, disabled: true, reason: "You already command 2.", showReason: true }],
      warbands: [{ id: "x", name: "The Salted Anchors", level: 2, retraining: "Retraining: 3 days" }] },
    isPartial: true, missingCount: 4, selectedSource: { slug: "wr" },
  };
};
const build = (state) => {
  const ctx = base(state.replace("-pending", ""));
  if (state === "player-pending") { ctx.myPick = null; ctx.myResult = { activityName: "Training", label: "Serious option", total: 17, dc: 13, success: true, effectSummary: "", pendingChoice: { prompt: "Choose a weapon to train with.", freeText: true, options: ["Longsword", "Shortbow", "Spear", "Warhammer"].map((label, i) => ({ id: "o" + i, label, disabled: i === 3, reason: i === 3 ? "Already trained." : "" })).concat([{ id: "t", label: "Replace Fireball", gain: [{ uuid: "u1", label: "Lightning Bolt" }, { uuid: "u2", label: "Slow" }] }]) } }; }
  return { context: ctx };
};
export default { previewHeight: 900, title: "SDE.downtime.title", icon: "fas fa-mug-hot", classes: ["shadowdark", "sde-downtime"], width: 720, template: "templates/downtime.hbs", initial: "solo", build,
  toolbar: ["solo", "gm", "player", "player-pending"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""), actions: { t: { state: "{state}" } } };
