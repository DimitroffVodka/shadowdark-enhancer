/**
 * Shadowdark Enhancer — Encounter Build data layer
 * Slice 1c: slot model, die-format definitions, validation, save-to-RollTable.
 *
 * Pure data module — no DOM, no Application logic. The Build Table tab
 * inside EncounterRollerApp calls into this module for its data needs.
 */

import { MODULE_ID } from "../module-id.mjs";

/**
 * Supported die formulas for Build Table.
 *
 * `min` / `max` define the inclusive range of natural rolls the die can
 * produce — used to pre-seed slots when the GM switches die types and
 * to validate slot ranges on save.
 *
 * 2d6 is included because Shadowdark uses it for reaction-style tables
 * where bell-curve distribution matters (rare extremes, common middle).
 * Slot ranges are GM-editable so a 2d6 table can group its 11 outcomes
 * into the conventional 3 bands (e.g. 2-4 / 5-9 / 10-12).
 */
export const DICE = [
  { key: "1d4",  label: "d4",  formula: "1d4",  min: 1, max: 4  },
  { key: "1d6",  label: "d6",  formula: "1d6",  min: 1, max: 6  },
  { key: "1d8",  label: "d8",  formula: "1d8",  min: 1, max: 8  },
  { key: "1d10", label: "d10", formula: "1d10", min: 1, max: 10 },
  { key: "1d12", label: "d12", formula: "1d12", min: 1, max: 12 },
  { key: "2d6",  label: "2d6", formula: "2d6",  min: 2, max: 12 },
];

export const DEFAULT_DIE_KEY = "1d6";

/**
 * Slot shape:
 *   {
 *     min:       number,          // inclusive lower bound of die rolls hitting this slot
 *     max:       number,          // inclusive upper bound
 *     name:      string,          // display name (monster name OR free-text)
 *     uuid:      string | null,   // Actor UUID when filled by drag-drop; null for flavor
 *     appearing: string,          // appearing formula like "1d4", "" if blank
 *     flavor:    boolean,         // true when entry is free-text rather than a monster
 *   }
 *
 * An "empty" slot has name="", uuid=null, appearing="", flavor=false.
 */

export const EncounterBuild = {

  DICE,
  DEFAULT_DIE_KEY,

  /**
   * Look up a die definition by key. Falls back to d6 if not found.
   * @param {string} key
   * @returns {object} die definition
   */
  getDie(key) {
    return DICE.find(d => d.key === key) ?? DICE.find(d => d.key === DEFAULT_DIE_KEY);
  },

  /**
   * Generate the default slot list for a given die — one empty slot per
   * possible roll outcome, with min=max=face. The GM can then merge
   * slots by editing ranges or delete individual slots.
   *
   * @param {string} dieKey
   * @returns {Array<object>} slot list
   */
  defaultSlots(dieKey) {
    const die = this.getDie(dieKey);
    const slots = [];
    for (let face = die.min; face <= die.max; face++) {
      slots.push(this.emptySlot(face, face));
    }
    return slots;
  },

  /**
   * Build a single empty slot covering the given range.
   * @param {number} min
   * @param {number} max
   * @returns {object}
   */
  emptySlot(min, max) {
    return {
      min,
      max,
      name: "",
      uuid: null,
      appearing: "",
      flavor: false,
    };
  },

  /**
   * Fill a slot with the given Actor. Mutates the slot in place.
   * @param {object} slot
   * @param {Actor} actor
   */
  fillSlotFromActor(slot, actor) {
    slot.name = actor.name ?? "Unknown";
    slot.uuid = actor.uuid;
    slot.flavor = false;
    // Leave `appearing` alone — GM may have already set a formula and
    // we don't want to clobber it on re-drop.
  },

  /**
   * Fill a slot with free-text (flavor entry). Mutates in place.
   * @param {object} slot
   * @param {string} text
   */
  fillSlotFromText(slot, text) {
    slot.name = text.trim();
    slot.uuid = null;
    slot.flavor = true;
    slot.appearing = ""; // flavor entries don't have counts
  },

  /**
   * Clear a slot back to empty, preserving its range.
   * @param {object} slot
   */
  clearSlot(slot) {
    slot.name = "";
    slot.uuid = null;
    slot.appearing = "";
    slot.flavor = false;
  },

  /**
   * Compute the next free face number for adding a new slot — the
   * smallest face not already covered by an existing slot. Returns the
   * die's min if no slots exist, or null if the entire die range is
   * covered (caller can decide what to do — e.g. extend the last slot).
   *
   * @param {Array<object>} slots
   * @param {string} dieKey
   * @returns {number | null}
   */
  nextFreeFace(slots, dieKey) {
    const die = this.getDie(dieKey);
    for (let face = die.min; face <= die.max; face++) {
      const covered = slots.some(s => face >= s.min && face <= s.max);
      if (!covered) return face;
    }
    return null;
  },

  /**
   * Validate slot ranges against a die. Returns a list of issues with
   * severity tags. Empty list = perfect.
   *
   * Severity levels:
   *   - "error":   slot range is impossible for this die (e.g. face 7 on a d6)
   *   - "warning": gaps in coverage, or overlaps between slots
   *
   * The Build tab UI shows warnings but doesn't block save — some
   * tables intentionally have gaps ("no encounter on a 1-2") or
   * overlaps ("either result possible on a 3").
   *
   * @param {Array<object>} slots
   * @param {string} dieKey
   * @returns {Array<{severity: string, message: string}>}
   */
  validateSlots(slots, dieKey) {
    const die = this.getDie(dieKey);
    const issues = [];

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.min < die.min || s.max > die.max) {
        issues.push({
          severity: "error",
          message: `Slot ${i + 1} range ${s.min}-${s.max} is outside the die's ${die.min}-${die.max} range.`,
        });
      }
      if (s.min > s.max) {
        issues.push({
          severity: "error",
          message: `Slot ${i + 1} has min (${s.min}) greater than max (${s.max}).`,
        });
      }
    }

    // Overlap check (only against later slots so we don't double-report).
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i], b = slots[j];
        if (a.max >= b.min && a.min <= b.max) {
          issues.push({
            severity: "warning",
            message: `Slots ${i + 1} and ${j + 1} overlap.`,
          });
        }
      }
    }

    // Gap check: every face in the die's range should be covered by some slot.
    for (let face = die.min; face <= die.max; face++) {
      const covered = slots.some(s => face >= s.min && face <= s.max);
      if (!covered) {
        issues.push({
          severity: "warning",
          message: `Face ${face} is not covered by any slot.`,
        });
      }
    }

    return issues;
  },

  /**
   * Save the in-memory slot list as a world RollTable. Each non-empty
   * slot becomes one TableResult with its range and the appearing
   * formula stored on `flags.shadowdark-enhancer.appearing` (which
   * encounter-roller-app reads back in `_rollCount`).
   *
   * Does NOT modify the active-table setting per design.
   *
   * @param {object} opts
   * @param {string} opts.name        — table display name
   * @param {string} opts.dieKey      — one of DICE entries' .key
   * @param {Array<object>} opts.slots
   * @returns {Promise<RollTable>}    — the created RollTable
   */
  async saveAsRollTable({ name, dieKey, slots }) {
    const die = this.getDie(dieKey);
    const trimmedName = (name ?? "").trim() || "Untitled Encounter Table";

    // Build TableResult data from non-empty slots only.
    const resultData = [];
    for (const s of slots) {
      if (!s.name) continue; // skip empty slots entirely
      const flagAppearing = s.appearing?.trim() || null;

      // Foundry v13 split TableResult.text into name + description.
      // We put the entry label in `name` (the display title) since our
      // entries are short single-line labels (monster name or flavor
      // line). Reads use the same field via _resultBody's fallback
      // chain, so this round-trips cleanly.
      const baseResult = {
        name: s.name,
        range: [s.min, s.max],
        weight: (s.max - s.min + 1),
      };

      if (s.flavor) {
        // Free-text entry — no document reference.
        baseResult.type = CONST.TABLE_RESULT_TYPES.TEXT;
      } else if (s.uuid) {
        // Monster entry — store the document reference so encounter
        // result parsing can resolve the actor via the standard fields.
        const parsed = foundry.utils.parseUuid?.(s.uuid) ?? null;
        baseResult.type = CONST.TABLE_RESULT_TYPES.DOCUMENT;
        if (parsed?.collection) {
          baseResult.documentCollection = parsed.collection.collection ?? parsed.collection;
        }
        if (parsed?.id || parsed?.documentId) {
          baseResult.documentId = parsed.id ?? parsed.documentId;
        }
      }

      // Stash the appearing formula as a flag — preview + result rolling
      // both read it from this key.
      if (flagAppearing) {
        baseResult.flags = {
          [MODULE_ID]: { appearing: flagAppearing },
        };
      }

      resultData.push(baseResult);
    }

    const tableData = {
      name: trimmedName,
      formula: die.formula,
      replacement: true,
      displayRoll: true,
      results: resultData,
    };

    return RollTable.create(tableData);
  },
};
