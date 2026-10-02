/**
 * Shadowdark Enhancer — Bastion actor data model.
 *
 * Registered as the system data model for `shadowdark-enhancer.bastion`. The
 * fields are the state bastion-core.mjs works on, so a sheet reads
 * `stateOf(actor)`, hands it to the rules and writes the result back.
 */

import { BASTION_TYPES, stats } from "./bastion-core.mjs";

const fields = foundry.data.fields;

const int = (initial = 0, opts = {}) =>
  new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

export class BastionDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      type: new fields.StringField({ required: true, blank: false, initial: "house", choices: BASTION_TYPES.map((t) => t.id) }),
      // Weeks until the bastion itself stands (a new House: 1). Upgrades wait for it.
      weeksLeft: int(1, { min: 0 }),
      week: int(0, { min: 0 }),
      hp: new fields.SchemaField({ value: int(40, { min: 0 }) }),
      treasury: int(0, { min: 0 }),
      // The party that owns it, an actor UUID, or "" for none. Only a way to find who pays.
      party: new fields.StringField({ required: true, blank: true, initial: "" }),
      // `slot` is the place on the plan an upgrade took; -1 for the moat, which has none.
      upgrades: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false }),
        slot: int(0, { min: -1 }),
        weeksLeft: int(1, { min: 0 }),
      }), { initial: [] }),
      repair: new fields.SchemaField({ hp: int(0, { min: 0 }), weeksLeft: int(0, { min: 0 }) }),
      // The calendar months whose Casino income is paid, so the clock paying one month twice is harmless.
      incomeMonths: new fields.ArrayField(new fields.NumberField({ required: true, nullable: false, integer: true }), { initial: [] }),
      // The names of the trophies in the Trophy Room, oldest first.
      trophies: new fields.ArrayField(new fields.StringField({ required: true, blank: false }), { initial: [] }),
      // The world-clock day the Aviary's pigeon last flew (one message a day), or null.
      pigeonDay: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null }),
      // Newest last. `key` is an i18n key and `data` fills it; an array, never a keyed map.
      log: new fields.ArrayField(new fields.SchemaField({
        week: int(0, { min: 0 }),
        key: new fields.StringField({ required: true, blank: false }),
        data: new fields.ObjectField({ required: true, initial: {} }),
      }), { initial: [] }),
      notes: new fields.HTMLField({ required: true, blank: true, initial: "" }),
    };
  }

  prepareDerivedData() {
    this.derived = stats(this);
  }
}
