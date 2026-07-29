/**
 * Pit Fighting — the pure half of setting up a bout (Cursed Scroll 2, pgs 20–24).
 *
 * Structure and thresholds ONLY. Every piece of readable content — venue
 * descriptions, twist details, what each stakes tier is fought for, the foes —
 * lives in the RollTables you import from your own copy of the book, exactly like
 * the rest of the sealed-content pipeline. What is here is dice ranges and
 * mechanics: the same class of bare numbers as the reaction bands in
 * encounter-result.mjs and the renown ladder in renown-core.mjs.
 *
 * The flow this models: roll a Venue, roll Stakes against the party's average
 * level, pick a danger level, draw a foe from the encounter table that danger
 * selects, and secretly check for a Twist. The book leaves the danger level and
 * the foe to the GM ("the GM decides the danger level and foe"), so the module
 * SUGGESTS and never decides — see `suggestedDanger`.
 *
 * Foundry-free on purpose: node-tested, no globals touched.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* Stakes                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The four stakes tiers, keyed low→epic, with the roll band that reaches each.
 *
 * Rolled as APL + 1d6, so the lowest reachable total for a level-1 party is 2 and
 * there is no upper bound — a high-level party rolls into Epic routinely. `max`
 * is inclusive; the last tier is open-ended.
 *
 * `table` is the display name of the d4 prize table for that tier, which is what
 * the imported RollTable is called. Naming a table is not quoting it.
 */
export const STAKES_TIERS = [
  { key: "low", label: "Low", min: 2, max: 5, table: "Low Stakes" },
  { key: "mid", label: "Mid", min: 6, max: 10, table: "Mid Stakes" },
  { key: "high", label: "High", min: 11, max: 13, table: "High Stakes" },
  { key: "epic", label: "Epic", min: 14, max: Infinity, table: "Epic Stakes" },
];

/** Coerce to a finite integer, or `fallback` when that is impossible. */
function _int(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The party's Average Party Level, which the stakes roll is made against.
 *
 * Rounded to nearest, halves up — the book says to use the APL and doesn't say
 * how to round a fractional one, so the module picks the ordinary convention and
 * exposes `mean` beside it so a GM can see what was rounded. Non-numeric levels
 * are ignored rather than counted as zero, which would drag a party of four down
 * for one unreadable sheet. An empty party is APL 1, not 0: level 0 exists in
 * Shadowdark, but "no characters" is not a level-0 party.
 *
 * @param {Array<number|{level:number}>} party  levels, or objects carrying one
 * @returns {{apl:number, mean:number, counted:number}}
 */
export function averagePartyLevel(party = []) {
  // Coerce only from a number or a non-blank numeric string. Reaching for
  // Number() directly does NOT work here: Number(null), Number("") and Number([])
  // are all 0, so a missing level would be counted as a level-0 character and
  // pull the average down — the precise failure this function promises to avoid.
  const levels = (Array.isArray(party) ? party : [])
    .map((p) => (typeof p === "object" && p !== null ? p.level : p))
    .map((l) => (typeof l === "number" || (typeof l === "string" && l.trim() !== "")
      ? Math.trunc(Number(l))
      : NaN))
    .filter((l) => Number.isFinite(l));

  if (!levels.length) return { apl: 1, mean: 0, counted: 0 };

  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  return { apl: Math.floor(mean + 0.5), mean, counted: levels.length };
}

/**
 * The stakes tier a total reaches. Totals below the first band read as Low
 * rather than throwing: a level-0 funnel party rolling a 1 is off the bottom of
 * the printed table, and the sensible reading is the lowest tier.
 *
 * @param {number} total  APL + 1d6
 */
export function stakesFor(total) {
  const t = _int(total, 0);
  return STAKES_TIERS.find((tier) => t <= tier.max) ?? STAKES_TIERS[0];
}

/** The tier one step up, for the twist that raises the stakes. Epic is the cap. */
export function stakesUp(key, steps = 1) {
  const i = STAKES_TIERS.findIndex((t) => t.key === key);
  if (i < 0) return STAKES_TIERS[0];
  return STAKES_TIERS[Math.min(i + Math.max(0, _int(steps, 0)), STAKES_TIERS.length - 1)];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Venue                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Venue is a 2d6 table of five rows with uneven bands, the top two being single
 * numbers. Only the ranges are here; the row TEXT comes from the imported table,
 * which is why each row carries `row` — the 1-based index to read off the drawn
 * RollTable result rather than a description to print.
 */
export const VENUE_ROWS = [
  { row: 1, min: 2, max: 4 },
  { row: 2, min: 5, max: 7 },
  { row: 3, min: 8, max: 10 },
  { row: 4, min: 11, max: 11 },
  { row: 5, min: 12, max: 12 },
];

/** Which venue row a 2d6 total lands on. Out-of-range totals clamp. */
export function venueRowFor(total) {
  const t = Math.min(12, Math.max(2, _int(total, 2)));
  return VENUE_ROWS.find((r) => t <= r.max) ?? VENUE_ROWS[VENUE_ROWS.length - 1];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Danger level                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The three danger levels, and which tier of encounter table each one draws from.
 *
 * High and Epic stakes share one set of encounter tables in the book, which is
 * why `encounterTier` exists separately from the key: four stakes tiers, three
 * table tiers.
 */
export const DANGER_LEVELS = [
  { key: "low", label: "Low", encounterTier: "low" },
  { key: "mid", label: "Mid", encounterTier: "mid" },
  { key: "high", label: "High", encounterTier: "high-epic" },
];

/**
 * The danger level the stakes imply — a SUGGESTION, not a ruling.
 *
 * The book hands the GM two inputs, the stakes and the venue, and then says the
 * GM decides. Only the stakes half can be derived: the venue's riskiness is a
 * judgement about a described place, and the book prints no risk rating to read
 * it off. So this maps stakes→danger and the caller is expected to offer an
 * override; `pit-fighting-app.mjs` renders it as a dropdown pre-set to this.
 *
 * Deriving it from the venue row instead would mean inventing a risk column the
 * book doesn't have.
 *
 * @param {string} stakesKey  "low" | "mid" | "high" | "epic"
 */
export function suggestedDanger(stakesKey) {
  if (stakesKey === "low") return DANGER_LEVELS[0];
  if (stakesKey === "mid") return DANGER_LEVELS[1];
  return DANGER_LEVELS[2];   // high and epic both fight at High danger
}

/** Look a danger level up by key, falling back to Mid on junk. */
export function dangerFor(key) {
  return DANGER_LEVELS.find((d) => d.key === key) ?? DANGER_LEVELS[1];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Encounter tables                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The display name of the encounter table a bout draws its foes from.
 *
 * Six tables: three danger tiers × solo/group. They are named for the STAKES in
 * print, but it is the DANGER level that selects which one to use, so a GM who
 * overrides the danger changes the table too — the whole reason the override
 * exists. Solo vs group follows the number of fighters entering the pit, not the
 * size of the party.
 *
 * Returns the name only; resolving it to a RollTable is the app's job, because
 * that needs the compendium.
 *
 * @param {object} args
 * @param {string} args.danger    danger key
 * @param {boolean} args.group    true when more than one PC fights
 */
export function encounterTableName({ danger, group = false } = {}) {
  const tier = dangerFor(danger).encounterTier;
  const label = tier === "high-epic" ? "High/epic Stakes" : `${dangerFor(danger).label} Stakes`;
  return `${label} Pit Fight (${group ? "group" : "solo"})`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Twist                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The 2d6 twist bands, as mechanics rather than prose.
 *
 * `effect` is a machine-readable tag the app acts on; the sentence a player hears
 * comes from the imported Twist table. `subRoll` is the extra die a band calls
 * for — one band picks its own detail from a d4, which is why a twist result can
 * need two rolls before it means anything.
 *
 * `stakesUp` is the one band with a mechanical consequence the module can apply
 * on its own: it raises the stakes a step, which changes the prize table.
 */
export const TWIST_BANDS = [
  { key: "danger", min: 2, max: 5, effect: "extra-danger", subRoll: "1d4" },
  { key: "none", min: 6, max: 9, effect: "none", subRoll: null },
  { key: "stakesUp", min: 10, max: 11, effect: "stakes-up-1", subRoll: null },
  { key: "boon", min: 12, max: 12, effect: "boon", subRoll: null },
];

/** Which twist band a 2d6 total lands on. Out-of-range totals clamp. */
export function twistFor(total) {
  const t = Math.min(12, Math.max(2, _int(total, 2)));
  return TWIST_BANDS.find((b) => t <= b.max) ?? TWIST_BANDS[TWIST_BANDS.length - 1];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Results                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The module's DEFAULT renown for a bout — not a number from the book.
 *
 * CS2 says pit fighting earns treasure, experience and fame, and prints no value
 * for the fame half. Rather than invent a ladder that scales with stakes (which
 * would read as a rule and isn't one), the default is a flat point for a win and
 * nothing for a loss, and the GM edits the field before applying. Documented as
 * the module's suggestion everywhere it is shown.
 */
export const DEFAULT_BOUT_RENOWN = { win: 1, loss: 0 };

/** The suggested renown change for a bout outcome. */
export function suggestedRenown(outcome) {
  return outcome === "win" ? DEFAULT_BOUT_RENOWN.win : DEFAULT_BOUT_RENOWN.loss;
}

/**
 * Assemble a bout from rolls already made, so the whole set-up is one testable
 * value. Every field is either a die total the caller rolled or a mechanic
 * derived here — no text, and no dice rolled in this file.
 *
 * @param {object} args
 * @param {number}  args.venueTotal   2d6
 * @param {number}  args.stakesTotal  APL + 1d6
 * @param {number}  [args.apl]        recorded for display
 * @param {string}  [args.danger]     GM override; omitted means use the suggestion
 * @param {boolean} [args.group]
 * @param {number}  [args.twistTotal] 2d6; omit to leave the twist unrolled
 */
export function buildBout({ venueTotal, stakesTotal, apl = null, danger = null, group = false, twistTotal = null } = {}) {
  const venue = venueRowFor(venueTotal);
  const rolledStakes = stakesFor(stakesTotal);
  const twist = twistTotal === null || twistTotal === undefined ? null : twistFor(twistTotal);

  // The stakes-raising twist is applied here rather than at display time, so the
  // prize table the GM is pointed at is the one actually being fought for.
  const stakes = twist?.effect === "stakes-up-1" ? stakesUp(rolledStakes.key) : rolledStakes;

  // Danger follows the ROLLED stakes. A twist that raises the purse mid-bout does
  // not retroactively make the fight deadlier — the GM already set the danger and
  // the fighters already accepted on that basis.
  const dangerLevel = danger ? dangerFor(danger) : suggestedDanger(rolledStakes.key);

  return {
    apl: apl === null ? null : _int(apl, 0),
    venue: { total: _int(venueTotal, 0), row: venue.row },
    stakes: {
      total: _int(stakesTotal, 0),
      key: stakes.key,
      label: stakes.label,
      table: stakes.table,
      raised: stakes.key !== rolledStakes.key,
      rolledKey: rolledStakes.key,
    },
    danger: {
      key: dangerLevel.key,
      label: dangerLevel.label,
      suggested: suggestedDanger(rolledStakes.key).key,
      overridden: !!danger && danger !== suggestedDanger(rolledStakes.key).key,
    },
    twist: twist && {
      total: _int(twistTotal, 0),
      key: twist.key,
      effect: twist.effect,
      subRoll: twist.subRoll,
    },
    encounterTable: encounterTableName({ danger: dangerLevel.key, group }),
    group: !!group,
  };
}
