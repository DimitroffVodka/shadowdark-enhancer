import {
  ABILITY_ORDER, DEFAULT_STAT_METHOD,
  STAT_METHODS,
  POINT_BUY_MIN,
} from "./constants.mjs";

/**
 * Empty art slot — the shape `CharBuilderState.art` always carries. Two plain
 * image paths (or URLs); a null slot means "leave the system default alone".
 */
export const emptyArt = () => ({
  portrait: null,   // server path / URL for `actor.img`
  token: null,      // server path / URL for `prototypeToken.texture.src`
});

/**
 * Mutable in-progress character state for the builder.
 *
 * Deliberately a plain data bag (no history/validation engine) — step managers
 * read and write it directly, and on finish the builder translates it into the
 * `actorData` + `allItems[]` shape that
 * `CharacterGeneratorSD.createActorFromData` expects.
 */
export class CharBuilderState {
  constructor({ level0 = false, statMethod = DEFAULT_STAT_METHOD } = {}) {
    const method = STAT_METHODS[statMethod];
    /** Level-0 "funnel" build (no class, rolled gear) vs a levelled character. */
    this.level0 = level0;
    /** Target character level (1–MAX_CHAR_LEVEL). Ignored for level-0 builds. */
    this.level = 1;

    this.name = "";
    this.trinket = "";
    this.alignment = "neutral";

    /**
     * Portrait + token art chosen on the Preview step (gallery, FilePicker, a
     * pasted URL, or the bundled suggestion). Every slot null = "leave the system
     * defaults alone" — commit only writes the fields that were actually set.
     */
    this.art = emptyArt();

    // --- Abilities ----------------------------------------------------------
    this.stats = {
      method: statMethod,     // key into STAT_METHODS (GM-dictated)
      pool: method?.fixed ? [...method.fixed] : [], // rolled or fixed assignment values
      values: Object.fromEntries(ABILITY_ORDER.map((k) => [
        k, method?.pointBuy ? POINT_BUY_MIN : 0,
      ])),
      assignment: Object.fromEntries(ABILITY_ORDER.map((k) => [k, null])),
    };

    // --- Filled by later steps ---------------------------------------------
    this.ancestry = null;   // { uuid, name, item }
    this.class = null;      // { uuid, name, item }
    this.background = null;
    this.deity = null;
    this.hp = { max: 0, rolled: null };
    this.coins = { gp: 0, sp: 0, cp: 0 };
    this.goldRolled = false;
    this.gear = [];             // [{ uuid, name, qty }]
    this.ancestryTalents = [];  // chosen ancestry talent UUIDs (multi-talent ancestries offer a choice)
    this.classTalents = [];     // rolled/chosen class talents [{ uuid, name }]
    this.classTalentRoll = null;// { total, resultText, options:[{uuid,name,isTable}] }
    this.bonusRolls = [];       // extra creation rolls (Ambitious, Black Lotus, patron boons…)
                                // [{ key, label, tableUuid, total, options, chosenUuid, chosenName, textResult }]
    this.talentChoices = {};    // REPLACEME-effect picks { instanceKey: { slug, label } } (Weapon Mastery weapon…)
    this.talentMemo = {};       // { classUuid: snapshot of the four fields above + hp } — restored when a class is re-picked
    this.spells = [];           // [{ uuid, name, tier }]
    this.languages = [];        // all known language UUIDs (fixed + chosen)
    this.languageChoices = { common: [], rare: [], select: [] }; // chosen UUIDs per pool
  }
}

/**
 * Levels ABOVE 1 at which the class tables grant a talent roll (3, 5, 7, 9 —
 * the odd ones; core rules pg 39 "Talent Roll", and the system's own
 * `LevelUpSD` gate `targetLevel % 2 !== 0`).
 *
 * Level 1's roll lives in `state.classTalentRoll`; these extras ride the
 * class step's existing bonus-roll machinery, one entry each.
 */
export function extraTalentLevels(level) {
  const out = [];
  for (let l = 3; l <= (Number(level) || 1); l += 2) out.push(l);
  return out;
}

/** Bonus-roll key for the class-talent roll gained at `level`. */
export const levelTalentKey = (level) => `level-talent-${level}`;

/** The level a `level-talent-N` key belongs to, or null for any other key. */
function levelOfTalentKey(key) {
  const m = /^level-talent-(\d+)$/.exec(String(key));
  return m ? Number(m[1]) : null;
}

/** Drop the level-talent rolls granted above `level`; leave every other roll. */
function trimTalentRolls(slice, level) {
  slice.bonusRolls = (slice.bonusRolls ?? []).filter((b) => {
    const l = levelOfTalentKey(b.key);
    return l === null || l <= level;
  });
}

/** Keep the first `spellsKnown[tier]` picks of each tier, drop the surplus. */
function trimSpells(state, spellsKnown) {
  const seen = {};
  state.spells = (state.spells ?? []).filter((s) => {
    seen[s.tier] = (seen[s.tier] ?? 0) + 1;
    return seen[s.tier] <= (Number(spellsKnown[s.tier]) || 0);
  });
}

/**
 * Re-scope an in-progress build to a new target level — the "chose 5, set the
 * character up, actually wanted 3" path. Pure (no Foundry globals) so it is
 * testable on its own.
 *
 * HP resets outright: it is one aggregate number, going UP needs fresh dice
 * anyway, and a half-rolled HP total is worse than an obviously-missing one.
 * Talent rolls and spells are TRIMMED rather than reset — a level-talent roll
 * is keyed by the level that granted it, so dropping the ones above the new
 * level is unambiguous and leaves the player's lower-level rolls alone.
 *
 * The per-class `talentMemo` snapshots get the same treatment, or switching to
 * another class and back would restore the level-5 rolls this just dropped.
 *
 * @param {CharBuilderState} state
 * @param {number} level        new target level
 * @param {object|null} spellsKnown  the class's `spellsknown[level]` row
 *                                   ({tier: count}); null leaves spells alone.
 */
export function applyLevelChange(state, level, spellsKnown = null) {
  // ponytail: dropped rolls are discarded, not parked by level, so a player
  // bound by `charBuilderLockHpRolls` / `charBuilderLockTalentRolls` can farm
  // rerolls by cycling the level. Park them in a level-keyed memo (the way
  // `talentMemo` parks them per class) if that turns out to matter at a table.
  state.level = level;
  state.hp = { max: 0, rolled: null };
  trimTalentRolls(state, level);
  for (const memo of Object.values(state.talentMemo ?? {})) {
    memo.hp = { max: 0, rolled: null };
    trimTalentRolls(memo, level);
  }
  if (spellsKnown) trimSpells(state, spellsKnown);
  return state;
}
