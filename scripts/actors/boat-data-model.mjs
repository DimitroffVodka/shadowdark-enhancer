/**
 * Shadowdark Enhancer — Boat actor data model.
 *
 * Registered as the system data model for `shadowdark-enhancer.boat`. The
 * Shadowdark *Western Reaches* vessel rules: capacity = HP (passengers don't
 * use gear slots), speed in 6-mile hexes/day (×10 ft in combat), crew, siege
 * weapons, sinking countdown, and the Crew/Fast/Oars/Portage/Unseaworthy/
 * Weapons properties.
 */

const fields = foundry.data.fields;

const int = (initial = 0, opts = {}) =>
  new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

export class BoatDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      boatType: new fields.StringField({ required: true, blank: true, initial: "Rowboat" }),

      hp: new fields.SchemaField({ value: int(4), max: int(4) }),
      ac: int(11),
      // Speed in 6-mile hexes per 8-hour day; combat feet = speed × 10.
      speed: int(2),

      passengers: int(0),
      // Cargo gear slots (passengers do NOT consume these).
      gearSlots: new fields.SchemaField({ max: int(0), used: int(0) }),

      crew: new fields.SchemaField({ required: int(0), current: int(0) }),

      // Passengers & crew aboard (actor UUIDs), like a party roster.
      occupants: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { initial: [] }
      ),

      properties: new fields.SchemaField({
        crew: new fields.BooleanField({ initial: false }),        // needs 4+ trained crew
        fast: new fields.BooleanField({ initial: false }),         // double near in combat
        oars: new fields.BooleanField({ initial: false }),         // Row Galley / Oars
        portage: new fields.BooleanField({ initial: false }),      // carried overland
        unseaworthy: new fields.BooleanField({ initial: false }),  // cumulative 1:6 sink
        weapons: new fields.BooleanField({ initial: false }),      // mounts siege weapons
      }),
      propertiesNote: new fields.StringField({ required: true, blank: true, initial: "" }),

      // Up to two mounted siege weapons (trebuchets are galleon-only).
      siege: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false }),
        { initial: [] }
      ),

      sinking: new fields.SchemaField({
        active: new fields.BooleanField({ initial: false }),
        roundsRemaining: int(0),
      }),

      notes: new fields.HTMLField({ required: true, blank: true, initial: "" }),
    };
  }

  prepareDerivedData() {
    const sys = this;
    const hpMax = sys.hp?.max ?? 0;
    const hpVal = sys.hp?.value ?? 0;

    sys.derived = {
      capacity: hpMax,                                 // passengers = HP
      combatSpeedFeet: (sys.speed ?? 0) * 10,           // vessel moves speed×10 ft
      repairCost: Math.max(0, hpMax - hpVal),           // 1 gp per HP restored, 1 week
      sinkable: hpVal <= 0,                             // 0 HP / capsized → sinks in 1d4
      cargoFree: (sys.gearSlots?.max ?? 0) - (sys.gearSlots?.used ?? 0),
      crewShort: (sys.crew?.current ?? 0) < (sys.crew?.required ?? 0),
    };
  }
}
