/**
 * Shadowdark Enhancer — Bastions: the rules (pure).
 *
 * A bastion is a place the party owns: a House, Outpost, Keep or Castle, with
 * up to a type's number of upgrades, one of each, a week each to build. Ordinary
 * weapons can't harm it; at 0 HP its walls are breached; repair is a week and 1
 * gp per HP. Each month a d6 roll of 1 brings a disaster (a d4).
 *
 * State (the actor's `system`):
 *   type        "house" | "outpost" | "keep" | "castle"
 *   weeksLeft   weeks until the bastion itself is built (0 = standing)
 *   hp          { value }, the maximum is the type's
 *   treasury    gp the bastion holds
 *   week        weeks the bastion has stood, counted by advanceWeek
 *   upgrades    [{ id, slot, weeksLeft }]  slot is its place on the plan, -1 for the moat
 *   repair      { hp, weeksLeft }  hp being mended, 0 weeksLeft when none
 *   incomeMonths  the calendar months whose Casino income is paid (month keys, the last few)
 *   trophies    the names of the trophies placed in the Trophy Room, oldest first, capped
 *   pigeonDay   the world-clock day the Aviary's pigeon last flew, or null
 *   log         [{ week, key, data }]  newest last, capped
 *
 * Every function takes a state and returns a NEW one with the log lines it
 * added, so the sheet writes one update and a test checks the whole result.
 * Strings are i18n keys written out in full (the i18n test scans for them).
 */

/** Costs in gp, AC, HP, upgrade slots, build time in weeks, and the plan's size. */
export const BASTION_TYPES = [
  { id: "house", name: "SDE.bastion.type.house.name", blurb: "SDE.bastion.type.house.blurb", cost: 200, ac: 12, hp: 40, slots: 3, weeks: 1 },
  { id: "outpost", name: "SDE.bastion.type.outpost.name", blurb: "SDE.bastion.type.outpost.blurb", cost: 300, ac: 15, hp: 50, slots: 5, weeks: 2 },
  { id: "keep", name: "SDE.bastion.type.keep.name", blurb: "SDE.bastion.type.keep.blurb", cost: 1000, ac: 18, hp: 100, slots: 10, weeks: 4 },
  { id: "castle", name: "SDE.bastion.type.castle.name", blurb: "SDE.bastion.type.castle.blurb", cost: 5000, ac: 18, hp: 300, slots: 20, weeks: 8 },
];

/** One of each; every one takes a week and a slot (the moat takes a slot but no room on the plan). */
export const BASTION_UPGRADES = [
  { id: "aviary", cost: 100, name: "SDE.bastion.upgrade.aviary.name", effect: "SDE.bastion.upgrade.aviary.effect" },
  { id: "armorer", cost: 200, name: "SDE.bastion.upgrade.armorer.name", effect: "SDE.bastion.upgrade.armorer.effect" },
  { id: "barracks", cost: 200, name: "SDE.bastion.upgrade.barracks.name", effect: "SDE.bastion.upgrade.barracks.effect" },
  { id: "blacksmith", cost: 100, name: "SDE.bastion.upgrade.blacksmith.name", effect: "SDE.bastion.upgrade.blacksmith.effect" },
  { id: "brewery", cost: 200, name: "SDE.bastion.upgrade.brewery.name", effect: "SDE.bastion.upgrade.brewery.effect" },
  { id: "casino", cost: 300, name: "SDE.bastion.upgrade.casino.name", effect: "SDE.bastion.upgrade.casino.effect" },
  { id: "dungeon", cost: 300, name: "SDE.bastion.upgrade.dungeon.name", effect: "SDE.bastion.upgrade.dungeon.effect" },
  { id: "granary", cost: 100, name: "SDE.bastion.upgrade.granary.name", effect: "SDE.bastion.upgrade.granary.effect" },
  { id: "idol", cost: 400, name: "SDE.bastion.upgrade.idol.name", effect: "SDE.bastion.upgrade.idol.effect" },
  { id: "infirmary", cost: 200, name: "SDE.bastion.upgrade.infirmary.name", effect: "SDE.bastion.upgrade.infirmary.effect" },
  { id: "kennels", cost: 300, name: "SDE.bastion.upgrade.kennels.name", effect: "SDE.bastion.upgrade.kennels.effect" },
  { id: "library", cost: 400, name: "SDE.bastion.upgrade.library.name", effect: "SDE.bastion.upgrade.library.effect" },
  { id: "moat", cost: 200, name: "SDE.bastion.upgrade.moat.name", effect: "SDE.bastion.upgrade.moat.effect" },
  { id: "stable", cost: 100, name: "SDE.bastion.upgrade.stable.name", effect: "SDE.bastion.upgrade.stable.effect" },
  { id: "tavern", cost: 400, name: "SDE.bastion.upgrade.tavern.name", effect: "SDE.bastion.upgrade.tavern.effect" },
  { id: "temple", cost: 400, name: "SDE.bastion.upgrade.temple.name", effect: "SDE.bastion.upgrade.temple.effect" },
  { id: "trading-post", cost: 100, name: "SDE.bastion.upgrade.tradingPost.name", effect: "SDE.bastion.upgrade.tradingPost.effect" },
  { id: "trophy-room", cost: 100, name: "SDE.bastion.upgrade.trophyRoom.name", effect: "SDE.bastion.upgrade.trophyRoom.effect" },
  { id: "vault", cost: 200, name: "SDE.bastion.upgrade.vault.name", effect: "SDE.bastion.upgrade.vault.effect" },
  { id: "wizard-tower", cost: 400, name: "SDE.bastion.upgrade.wizardTower.name", effect: "SDE.bastion.upgrade.wizardTower.effect" },
];

export const MOAT = "moat";
const LOG_CAP = 60;

export const typeOf = (id) => BASTION_TYPES.find((t) => t.id === id) ?? null;
export const upgradeOf = (id) => BASTION_UPGRADES.find((u) => u.id === id) ?? null;

const toInt = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : fallback);

/** A new bastion of a type: unbuilt, full HP, nothing in the treasury. */
export function newBastion(typeId = "house") {
  const type = typeOf(typeId) ?? BASTION_TYPES[0];
  return { type: type.id, weeksLeft: type.weeks, hp: { value: type.hp }, treasury: 0, week: 0, upgrades: [], repair: { hp: 0, weeksLeft: 0 }, incomeMonths: [], trophies: [], pigeonDay: null, log: [] };
}

/** The numbers a type fixes, with the bastion's current hit points. */
export function stats(state) {
  const type = typeOf(state?.type) ?? BASTION_TYPES[0];
  const hp = Math.max(0, Math.min(type.hp, toInt(state?.hp?.value, type.hp)));
  return {
    type, ac: type.ac, hp, maxHp: type.hp, slots: type.slots,
    used: (state?.upgrades ?? []).length,
    breached: hp <= 0,
    standing: toInt(state?.weeksLeft) <= 0,
    // 1 gp per HP missing, a week; a mend already under way counts as paid.
    repairCost: Math.max(0, type.hp - hp - toInt(state?.repair?.hp)),
  };
}

/** What the bastion and its upgrades are worth in gp (the type plus every upgrade). */
export function worth(state) {
  const type = typeOf(state?.type) ?? BASTION_TYPES[0];
  return type.cost + (state?.upgrades ?? []).reduce((sum, u) => sum + (upgradeOf(u.id)?.cost ?? 0), 0);
}

/** Upgrades that are finished and so give their effect. */
export const builtUpgrades = (state) => (state?.upgrades ?? []).filter((u) => toInt(u.weeksLeft) <= 0 && upgradeOf(u.id)).map((u) => u.id);

/** What the Granary saves a warband garrisoned here each month, in gp. */
export const GRANARY_SAVING_GP = 10;
/** What the Barracks adds to a garrisoned warband's healing each day. */
export const BARRACKS_HEAL = { n: 1, faces: 6 };
/** The Casino's income each month, in gp. */
export const CASINO_DICE = { n: 2, faces: 20 };
/** How many paid months a bastion keeps: far more than a clock move reaches back. */
const KEEP_INCOME_MONTHS = 24;

/** The Library's bonus on the downtime checks that are about learning (the skeleton's activity keys). */
export const LIBRARY_BONUS = 1;
export const LEARNING_ACTIVITIES = ["martialTraining", "magicalResearch"];

/** XP each party member gains for a notable trophy placed in a Trophy Room, and how many names a bastion keeps. */
export const TROPHY_XP = 1;
const KEEP_TROPHIES = 100;
const TROPHY_NAME_MAX = 60;

/**
 * The effects other features apply for a bastion: only a bastion that stands gives any, and
 * only through finished upgrades.
 * granary: warbands garrisoned here each cost GRANARY_SAVING_GP less a month.
 * barracks: warbands garrisoned here heal BARRACKS_HEAL more each day.
 * casino: it earns CASINO_DICE gp into the treasury each month.
 * library: the party's members get LIBRARY_BONUS on learning downtime checks.
 * trophyRoom: each notable trophy placed gives the party's members TROPHY_XP.
 * vault: the bastion can hold items, up to VAULT_SLOTS gear slots (bastion-vault-core.mjs).
 * aviary: one pigeon message can be sent a day.
 * infirmary: the monthly pestilence check is made with advantage by the bastion's patients.
 * stable: mounts stabled here (a mount's `bastion`) need no grazing or rations.
 */
export function effects(state) {
  const built = new Set(stats(state).standing ? builtUpgrades(state) : []);
  return { granary: built.has("granary"), barracks: built.has("barracks"), casino: built.has("casino"), library: built.has("library"), trophyRoom: built.has("trophy-room"), vault: built.has("vault"), stable: built.has("stable"), aviary: built.has("aviary"), infirmary: built.has("infirmary") };
}

/** Place a notable trophy in a finished Trophy Room: its name is kept (the last KEEP_TROPHIES) and logged. `error`: "trophyRoom" | "name". */
export function placeTrophy(state, name) {
  if (!effects(state).trophyRoom) return { state, error: "trophyRoom" };
  const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, TROPHY_NAME_MAX);
  if (!clean) return { state, error: "name" };
  const next = { ...state, trophies: [...(state.trophies ?? []), clean].slice(-KEEP_TROPHIES) };
  next.log = log(next, "SDE.bastion.log.trophy", { name: clean });
  return { state: next, error: null };
}

/** Send the day's pigeon from a finished Aviary: one a world-clock `day`. `error`: "aviary" | "flown". */
export function sendPigeon(state, day) {
  if (!effects(state).aviary) return { state, error: "aviary" };
  if (state.pigeonDay === day) return { state, error: "flown" };
  const next = { ...state, pigeonDay: day };
  next.log = log(next, "SDE.bastion.log.pigeon");
  return { state: next, error: null };
}

/** Take a trophy off the list (a typo, a trophy lost). The XP it gave stays given. */
export function removeTrophy(state, index) {
  const list = state.trophies ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return { state, error: "nothing" };
  return { state: { ...state, trophies: list.filter((_, i) => i !== index) }, error: null };
}

/** Is this month's Casino income owed: a finished Casino in a standing bastion, and the month not yet paid? */
export const owesIncome = (state, month) => effects(state).casino && !(state.incomeMonths ?? []).includes(month);

/** Pay a month's Casino income, `gp` rolled, into the treasury, and mark the month paid. Never twice for one month. */
export function payIncome(state, month, gp) {
  if (!owesIncome(state, month)) return { state, error: "none" };
  if (!Number.isInteger(gp) || gp < 0) return { state, error: "amount" };
  const next = { ...state, treasury: toInt(state.treasury) + gp, incomeMonths: [...new Set([...(state.incomeMonths ?? []), month])].sort((a, b) => a - b).slice(-KEEP_INCOME_MONTHS) };
  next.log = log(next, "SDE.bastion.log.income", { gp });
  return { state: next, error: null };
}

const lowestFree = (upgrades) => {
  const taken = new Set(upgrades.filter((u) => u.id !== MOAT).map((u) => u.slot));
  let slot = 0;
  while (taken.has(slot)) slot += 1;
  return slot;
};

const log = (state, key, data = {}) => [...(state.log ?? []), { week: toInt(state.week), key, data }].slice(-LOG_CAP);

/** Can this upgrade be started now? `reason` is one of unknown, built, full, unstanding, broke. */
export function canBuild(state, id) {
  const upgrade = upgradeOf(id);
  const s = stats(state);
  if (!upgrade) return { ok: false, reason: "unknown" };
  if ((state.upgrades ?? []).some((u) => u.id === id)) return { ok: false, reason: "built" };
  if (s.used >= s.slots) return { ok: false, reason: "full" };
  if (!s.standing) return { ok: false, reason: "unstanding" };
  if (toInt(state.treasury) < upgrade.cost) return { ok: false, reason: "broke" };
  return { ok: true, reason: null };
}

/** Start an upgrade: its cost leaves the treasury, it takes the lowest free place on the plan and a week to build. */
export function build(state, id) {
  const check = canBuild(state, id);
  if (!check.ok) return { state, error: check.reason };
  const upgrade = upgradeOf(id);
  const slot = id === MOAT ? -1 : lowestFree(state.upgrades);
  const next = { ...state, treasury: toInt(state.treasury) - upgrade.cost, upgrades: [...state.upgrades, { id, slot, weeksLeft: 1 }] };
  next.log = log(next, "SDE.bastion.log.buildStarted", { upgrade: upgrade.name, cost: upgrade.cost });
  return { state: next, error: null };
}

/** Take an upgrade down. Nothing is refunded and the others keep their places. */
export function takeDown(state, id) {
  const upgrade = upgradeOf(id);
  if (!upgrade || !(state.upgrades ?? []).some((u) => u.id === id)) return { state, error: "unknown" };
  const next = { ...state, upgrades: state.upgrades.filter((u) => u.id !== id) };
  next.log = log(next, "SDE.bastion.log.tornDown", { upgrade: upgrade.name });
  return { state: next, error: null };
}

/**
 * Change the type. A bastion with more upgrades than the new type holds can't shrink. The rest go to full HP,
 * and one already standing stays standing (a GM mending a mistake); one still going up takes the new type's weeks.
 */
export function changeType(state, typeId) {
  const type = typeOf(typeId);
  if (!type) return { state, error: "unknown" };
  if (type.id === state.type) return { state, error: null };
  if ((state.upgrades ?? []).length > type.slots) return { state, error: "tooMany" };
  const next = { ...state, type: type.id, hp: { value: type.hp }, weeksLeft: toInt(state.weeksLeft) > 0 ? type.weeks : 0, repair: { hp: 0, weeksLeft: 0 } };
  next.log = log(next, "SDE.bastion.log.retyped", { type: type.name });
  return { state: next, error: null };
}

/** Damage to the bastion's walls, down to 0 HP, where they are breached. */
export function damage(state, amount, key = "SDE.bastion.log.damaged") {
  const dealt = Math.max(0, toInt(amount));
  const hp = Math.max(0, stats(state).hp - dealt);
  const next = { ...state, hp: { value: hp } };
  next.log = log(next, key, { amount: dealt });
  if (hp === 0) next.log = log(next, "SDE.bastion.log.breached");
  return next;
}

/** Start a repair: 1 gp per HP missing from the treasury, done in a week. */
export function startRepair(state) {
  const { repairCost } = stats(state);
  if (repairCost <= 0) return { state, error: "nothing" };
  if (toInt(state.treasury) < repairCost) return { state, error: "broke" };
  const next = { ...state, treasury: toInt(state.treasury) - repairCost, repair: { hp: toInt(state.repair?.hp) + repairCost, weeksLeft: 1 } };
  next.log = log(next, "SDE.bastion.log.repairStarted", { hp: repairCost, cost: repairCost });
  return { state: next, error: null };
}

/** One week passes: the bastion and its upgrades finish building, a repair completes. */
export function advanceWeek(state) {
  const week = toInt(state.week) + 1;
  let next = { ...state, week };
  const finished = [];
  if (toInt(next.weeksLeft) > 0) {
    next.weeksLeft = toInt(next.weeksLeft) - 1;
    if (next.weeksLeft === 0) finished.push(["SDE.bastion.log.raised", { type: typeOf(next.type)?.name ?? "" }]);
  }
  if (toInt(next.weeksLeft) <= 0) {
    next.upgrades = next.upgrades.map((u) => {
      if (toInt(u.weeksLeft) <= 0) return u;
      const left = toInt(u.weeksLeft) - 1;
      if (left === 0) finished.push(["SDE.bastion.log.buildDone", { upgrade: upgradeOf(u.id)?.name ?? "" }]);
      return { ...u, weeksLeft: left };
    });
  }
  if (toInt(next.repair?.weeksLeft) > 0) {
    const left = toInt(next.repair.weeksLeft) - 1;
    if (left === 0) {
      const mended = toInt(next.repair.hp);
      next.hp = { value: Math.min(typeOf(next.type)?.hp ?? 0, stats(next).hp + mended) };
      next.repair = { hp: 0, weeksLeft: 0 };
      finished.push(["SDE.bastion.log.repaired", { hp: mended }]);
    } else next.repair = { ...next.repair, weeksLeft: left };
  }
  next.log = [...(state.log ?? [])];
  for (const [key, data] of finished) next.log = log(next, key, data);
  return next;
}

/**
 * The monthly disaster: a d6, and on a 1 a d4.
 * `die(n)` rolls 1..n (injected so a test can fix the dice).
 * 1 an army of 2d8 enemy warbands, 2 a natural disaster of 1d100 damage,
 * 3 pestilence (DC 12 CON or rat disease), 4 a dragonstrike.
 */
export function rollDisaster(die) {
  const d6 = die(6);
  if (d6 !== 1) return { d6, d4: null, kind: null };
  const d4 = die(4);
  const kinds = ["warbands", "natural", "pestilence", "dragon"];
  const out = { d6, d4, kind: kinds[d4 - 1] };
  if (out.kind === "warbands") out.count = die(8) + die(8);
  if (out.kind === "natural") out.damage = die(100);
  return out;
}

/** Record a monthly roll and apply its damage. A quiet month is logged too. */
export function applyDisaster(state, roll) {
  if (!roll.kind) {
    const next = { ...state };
    next.log = log(next, "SDE.bastion.log.quietMonth", { d6: roll.d6 });
    return next;
  }
  if (roll.kind === "natural") return damage(state, roll.damage, "SDE.bastion.log.naturalDisaster");
  const keys = { warbands: "SDE.bastion.log.warbands", pestilence: "SDE.bastion.log.pestilence", dragon: "SDE.bastion.log.dragon" };
  const next = { ...state };
  next.log = log(next, keys[roll.kind], { count: roll.count ?? 0 });
  return next;
}

/** Whole gold only: a deposit or withdrawal of nothing, or of a part of a coin, is not one. */
const wholeGp = (gp) => Number.isInteger(gp) && gp > 0;

/** Someone pays `gp` into the treasury. `who` is their name, for the log. */
export function deposit(state, gp, who = "") {
  if (!wholeGp(gp)) return { state, error: "amount" };
  const next = { ...state, treasury: toInt(state.treasury) + gp };
  next.log = log(next, "SDE.bastion.log.deposited", { who, gp });
  return { state: next, error: null };
}

/** The treasury pays `gp` out to someone. It can't go below nothing. */
export function withdraw(state, gp, who = "") {
  if (!wholeGp(gp)) return { state, error: "amount" };
  if (toInt(state.treasury) < gp) return { state, error: "broke" };
  const next = { ...state, treasury: toInt(state.treasury) - gp };
  next.log = log(next, "SDE.bastion.log.withdrew", { who, gp });
  return { state: next, error: null };
}

// ---------------------------------------------------------------- the actor's data

/** The rules' view of an actor: plain data, safe to hand to bastion-core and not to mutate. */
export function stateOf(actor) {
  const raw = actor?.system;
  const s = raw?.toObject?.() ?? raw ?? {};
  return {
    type: s.type ?? "house",
    weeksLeft: s.weeksLeft ?? 0,
    week: s.week ?? 0,
    hp: { value: s.hp?.value ?? 0 },
    treasury: s.treasury ?? 0,
    upgrades: (s.upgrades ?? []).map((u) => ({ id: u.id, slot: u.slot, weeksLeft: u.weeksLeft })),
    repair: { hp: s.repair?.hp ?? 0, weeksLeft: s.repair?.weeksLeft ?? 0 },
    incomeMonths: (s.incomeMonths ?? []).filter(Number.isFinite),
    trophies: (s.trophies ?? []).filter((n) => typeof n === "string"),
    pigeonDay: Number.isInteger(s.pigeonDay) ? s.pigeonDay : null,
    log: (s.log ?? []).map((e) => ({ week: e.week, key: e.key, data: { ...e.data } })),
  };
}

/** The document update that writes a state back (every rules field; the sheet never writes half). */
export function updateOf(state) {
  return {
    "system.type": state.type,
    "system.weeksLeft": state.weeksLeft,
    "system.week": state.week,
    "system.hp.value": state.hp.value,
    "system.treasury": state.treasury,
    "system.upgrades": state.upgrades,
    "system.repair.hp": state.repair.hp,
    "system.repair.weeksLeft": state.repair.weeksLeft,
    "system.incomeMonths": state.incomeMonths,
    "system.trophies": state.trophies,
    "system.pigeonDay": state.pigeonDay,
    "system.log": state.log,
  };
}
