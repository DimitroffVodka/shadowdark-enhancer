/**
 * Shadowdark Enhancer — Boat actor data model.
 *
 * Registered as the system data model for `shadowdark-enhancer.boat`. The
 * Shadowdark *Western Reaches* vessel rules: capacity = HP (passengers don't
 * use gear slots), speed in 6-mile hexes/day (×10 ft in combat), crew, siege
 * weapons, sinking countdown, and the Crew/Fast/Row Galley/Unseaworthy/Weapons
 * properties (WR dropped CS3's Oars & Portage).
 */

const fields = foundry.data.fields;

const int = (initial = 0, opts = {}) =>
  new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

export class BoatDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      boatType: new fields.StringField({ required: true, blank: true, initial: "Rowboat" }),
      // Purchase price in gp (from the WR boats table; 0 when unknown).
      cost: int(0),

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

      // Crew roles as [{ uuid, role }] (role = "captain" | "gunner"; absent =
      // ordinary passenger). An ARRAY, not a UUID-keyed map, because Foundry's
      // dotted-path update handling would mangle the dots in an Actor UUID key.
      // Existing boats migrate to [].
      roles: new fields.ArrayField(
        new fields.SchemaField({
          uuid: new fields.StringField({ required: true, blank: false }),
          role: new fields.StringField({ required: true, blank: false }),
        }),
        { initial: [] }
      ),

      // WR (p118) boat properties: Crew / Fast / Row Galley / Unseaworthy / Weapons.
      // (CS3's Oars & Portage are gone — WR dropped them; `oars` migrates to
      // `rowGalley`, see migrateData.)
      properties: new fields.SchemaField({
        crew: new fields.BooleanField({ initial: false }),         // needs 4+ trained crew
        fast: new fields.BooleanField({ initial: false }),         // double near in combat
        rowGalley: new fields.BooleanField({ initial: false }),    // difficult terrain as normal
        unseaworthy: new fields.BooleanField({ initial: false }),  // cumulative 1:6 sink
        weapons: new fields.BooleanField({ initial: false }),      // may mount siege weapons
      }),
      propertiesNote: new fields.StringField({ required: true, blank: true, initial: "" }),

      sinking: new fields.SchemaField({
        active: new fields.BooleanField({ initial: false }),
        roundsRemaining: int(0),
      }),

      notes: new fields.HTMLField({ required: true, blank: true, initial: "" }),
    };
  }

  /**
   * Migrate CS3-era boats to the WR property set: the `oars` flag becomes
   * `rowGalley`, and the dropped `portage` flag + the dead `siege` array are
   * removed (schema cleaning would drop them anyway; done explicitly for clarity).
   */
  static migrateData(source) {
    const p = source?.properties;
    if (p && typeof p === "object") {
      if ("oars" in p && !("rowGalley" in p)) p.rowGalley = p.oars;
      delete p.oars;
      delete p.portage;
    }
    delete source?.siege;
    return super.migrateData(source);
  }

  prepareDerivedData() {
    const sys = this;
    const hpMax = sys.hp?.max ?? 0;
    const hpVal = sys.hp?.value ?? 0;

    // Trained crew = the manually-tracked "hired" count (abstract NPC crew) PLUS
    // every occupant assigned a working role (Captain / Gunner / Crew). Plain
    // Passengers are riders and don't count. Only roles whose occupant is still
    // aboard are tallied.
    const occSet = new Set(sys.occupants ?? []);
    const CREW_ROLES = new Set(["captain", "gunner", "crew"]);
    const assignedCrew = (sys.roles ?? [])
      .filter((r) => occSet.has(r.uuid) && CREW_ROLES.has(r.role)).length;
    const crewAboard = (sys.crew?.current ?? 0) + assignedCrew;

    sys.derived = {
      capacity: hpMax,                                 // passengers = HP
      combatSpeedFeet: (sys.speed ?? 0) * 10,           // vessel moves speed×10 ft
      repairCost: Math.max(0, hpMax - hpVal),           // 1 gp per HP restored, 1 week
      sinkable: hpVal <= 0,                             // 0 HP → sinks in 1d4
      cargoFree: (sys.gearSlots?.max ?? 0) - (sys.gearSlots?.used ?? 0),
      assignedCrew,                                     // working occupants (roles)
      crewAboard,                                       // hired + assigned
      crewShort: crewAboard < (sys.crew?.required ?? 0),
    };
  }
}
