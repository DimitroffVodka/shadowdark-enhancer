import { ABILITY_ORDER, DEFAULT_STAT_METHOD } from "./constants.mjs";

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
    /** Level-0 "funnel" build (no class, rolled gear) vs a level-1 character. */
    this.level0 = level0;

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
      pool: [],               // the six rolled results, empty until rolled
      values: Object.fromEntries(ABILITY_ORDER.map((k) => [k, 0])),
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
    this.spells = [];           // [{ uuid, name, tier }]
    this.languages = [];        // all known language UUIDs (fixed + chosen)
    this.languageChoices = { common: [], rare: [], select: [] }; // chosen UUIDs per pool
  }
}
