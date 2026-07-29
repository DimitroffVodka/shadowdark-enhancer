/**
 * Downtime skeleton — the shipped metadata for the between-adventure downtime
 * activities printed in Cursed Scroll 6 and the Western Reaches Players Guide.
 *
 * COPYRIGHT CONSTRAINT (hard): this file ships NO rules text. It carries only
 * activity names, check abilities, DC numbers, paid flags, single-phrase
 * keyword matchers, and compressed <=5-word labels written for this module.
 * The outcome sentences are supplied at runtime by the user pasting their own
 * book page into the unlock box; downtime-parser.mjs matches those bullets to
 * the slots below and the text is stored in a world setting, never in the repo.
 *
 * Pure data + pure helpers: no Foundry globals, no Date, no Math.random.
 */

export const SKELETON_VERSION = "1.0.0";

/** Every DC the two sources print. Step-down walks left and floors at index 0. */
export const DC_LADDER = [9, 12, 15, 18, 20];

/**
 * Keyed by the module's `system.source.title` slug convention, so a downtime
 * source slug is the same string everywhere else in the suite.
 */
export const SOURCES = {
  "cs6": {
    slug: "cs6",
    label: "Cursed Scroll 6",
    pages: "26-27",
    authorityLabel: "City Guard",
    otherAuthority: "authorities",
    costFor: (level) => 10 * Math.max(1, Number(level) || 1),
  },
  "western-reaches": {
    slug: "western-reaches",
    label: "Western Reaches Players Guide",
    pages: "234-235",
    authorityLabel: "authorities",
    otherAuthority: "City Guard",
    costFor: () => 50,
  },
};

export const SOURCE_SLUGS = Object.keys(SOURCES);

/** `paid` is a boolean, or a per-source-slug map where the two books disagree. */
export function isPaid(slot, sourceSlug) {
  const p = slot?.paid;
  return typeof p === "object" && p !== null ? !!p[sourceSlug] : !!p;
}

export const DOWNTIME_SKELETON = {
  version: SKELETON_VERSION,
  activities: [
    {
      key: "spiritualism",
      name: "Spiritualism",
      check: { kind: "ability", abilities: ["wis"] },
      segment: { header: "SPIRITUALISM" },
      slots: [
        { key: "church-favor", dc: 9, paid: false, match: "church", label: "Gain favor with church", renownDelta: 1 },
        { key: "spiritual-strengthening", dc: 12, paid: false, match: "strengthening", label: "Spiritual strengthening", xpDelta: 2 },
        { key: "personal-insight", dc: 15, paid: true, match: "insight", label: "Reroll a talent roll" },
        { key: "spiritual-cleansing", dc: 18, paid: true, match: "curse", label: "End one curse" },
      ],
    },
    {
      key: "skulduggery",
      name: "Skulduggery",
      // Two check groups inside one activity: CHA slots plus DEX crime slots.
      check: {
        kind: "grouped",
        groups: [
          { id: "cha", abilities: ["cha"] },
          { id: "dex", abilities: ["dex"] },
        ],
      },
      segment: { header: "SKULDUGGERY" },
      slots: [
        { key: "rumor", group: "cha", dc: 9, paid: false, match: "rumor", label: "Start a rumor", renownDelta: 1, renownSigned: true },
        { key: "lay-low", group: "cha", dc: 12, paid: false, match: "lay low", label: "Lay low (minor crime)" },
        { key: "extortion", group: "cha", dc: 15, paid: false, match: "extortion", label: "Extortion: 25% price swing" },
        { key: "hide-out", group: "cha", dc: 18, paid: false, match: "hide out", label: "Hide out (major crime)" },
        // The one paid divergence between the two books.
        { key: "minor-crime", group: "dex", dc: 15, paid: { "cs6": true, "western-reaches": false }, match: "petty theft", label: "Commit a minor crime" },
        { key: "major-crime", group: "dex", dc: 18, paid: true, match: "murder", label: "Commit a major crime" },
      ],
    },
    {
      key: "martialTraining",
      name: "Martial Training",
      check: { kind: "choice", abilities: ["int", "str", "dex"] },
      gate: {
        kind: "hitDie",
        tiers: ["d4", "d6", "d8plus"],
        map: { d4: "d4", d6: "d6", d8: "d8plus", d10: "d8plus", d12: "d8plus" },
      },
      segment: { header: "MARTIAL TRAINING" },
      // Tier bullets repeat near-identical wording, so these slots are only ever
      // matched inside their own tier segment — never by the global phase 2.
      phase2: false,
      slots: [
        { key: "d4-hit-or-damage", tier: "d4", dc: 15, paid: true, match: "hit or damage", label: "+1 hit or damage" },
        { key: "d4-new-weapon", tier: "d4", dc: 18, paid: true, match: "new weapon", label: "New weapon (d6 max)" },
        { key: "d6-hit-and-damage", tier: "d6", dc: 12, paid: true, match: "hit and damage", label: "+1 hit and damage" },
        { key: "d6-new-weapon", tier: "d6", dc: 15, paid: true, match: "new weapon", label: "New weapon or armor step" },
        { key: "d8-new-armor-weapon", tier: "d8plus", dc: 9, paid: true, match: "armor or weapon", label: "New armor or weapon" },
        { key: "d8-hit-and-damage", tier: "d8plus", dc: 12, paid: true, match: "hit and damage", label: "+1 hit and damage" },
        { key: "d8-damage-die", tier: "d8plus", dc: 15, paid: true, match: "damage die", label: "Step up damage die" },
      ],
    },
    {
      key: "magicalResearch",
      name: "Magical Research",
      check: { kind: "spellcasting" },
      gate: {
        kind: "spellcaster",
        lists: ["arcane", "divine"],
        byAbility: { int: "arcane", wis: "divine", cha: "ambiguous" },
      },
      segment: { header: "MAGICAL RESEARCH" },
      slots: [
        { key: "arcane-scroll-adv", list: "arcane", dc: 12, paid: false, match: "scroll", label: "ADV on next scroll check" },
        { key: "arcane-create-scroll", list: "arcane", dc: 15, paid: true, match: "create a scroll", label: "Create scroll (tier ≤3)", phase2: false },
        { key: "arcane-create-potion", list: "arcane", dc: 15, paid: true, match: "potion", label: "Create a listed potion" },
        { key: "arcane-create-wand", list: "arcane", dc: 20, paid: true, match: "wand", label: "Create wand (tier ≤3)" },
        { key: "divine-spell-adv", list: "divine", dc: 12, paid: false, match: "three spells", label: "ADV on next three spells" },
        { key: "divine-create-scroll", list: "divine", dc: 15, paid: true, match: "create a scroll", label: "Create scroll (tier ≤3)", phase2: false },
        { key: "divine-trade-spell", list: "divine", dc: 15, paid: true, match: "trade", label: "Trade a known spell" },
        { key: "divine-potion-healing", list: "divine", dc: 18, paid: true, match: "potion of healing", label: "Create Potion of Healing" },
      ],
    },
  ],
};

/** Pinned expectation: the parser warns when a paste fills fewer than this. */
export const EXPECTED_SLOT_COUNT = 25;

/** Header text -> activity key. Pinned set, not a generic ALL-CAPS rule. */
export const ACTIVITY_BY_HEADER = Object.fromEntries(
  DOWNTIME_SKELETON.activities.map((a) => [a.segment.header, a.key]),
);

export function segmentIdForSlot(activity, slot) {
  switch (activity.key) {
    case "skulduggery": return `skulduggery.${slot.group}`;
    case "martialTraining": return `martialTraining.${slot.tier}`;
    case "magicalResearch": return `magicalResearch.${slot.list}`;
    default: return activity.key;
  }
}

/** Flat, skeleton-ordered view: one entry per slot. */
export const ALL_SLOTS = DOWNTIME_SKELETON.activities.flatMap((activity) =>
  activity.slots.map((slot) => ({ activity, slot, segmentId: segmentIdForSlot(activity, slot) })),
);

export const SLOT_INDEX = new Map(ALL_SLOTS.map((e) => [e.slot.key, e]));

export const SLOTS_BY_SEGMENT = ALL_SLOTS.reduce((map, e) => {
  if (!map.has(e.segmentId)) map.set(e.segmentId, []);
  map.get(e.segmentId).push(e);
  return map;
}, new Map());

const _matcherCache = new Map();

/** Case-insensitive whole-phrase matcher for a slot, compiled once. */
export function slotMatcher(slot) {
  let re = _matcherCache.get(slot.match);
  if (!re) {
    re = new RegExp(slot.match, "i");
    _matcherCache.set(slot.match, re);
  }
  return re;
}

/**
 * Slots the interleave-rescue pass (parser phase 2) may match globally.
 * Eligible only when the activity and the slot both allow it AND the
 * (match, dc) pair identifies exactly one slot in the whole skeleton.
 * Computed, never hand-maintained.
 */
export const PHASE2_ELIGIBLE = (() => {
  const counts = new Map();
  for (const { slot } of ALL_SLOTS) {
    const pair = `${slot.match.toLowerCase()}|${slot.dc}`;
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  const out = new Set();
  for (const { activity, slot } of ALL_SLOTS) {
    if (activity.phase2 === false || slot.phase2 === false) continue;
    if (counts.get(`${slot.match.toLowerCase()}|${slot.dc}`) !== 1) continue;
    out.add(slot.key);
  }
  return out;
})();
