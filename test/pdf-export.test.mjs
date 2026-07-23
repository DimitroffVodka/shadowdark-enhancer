/**
 * PDF character-sheet export mapping (AI-Council correction #6 + #9).
 *
 * Covers actor→field mapping with mocked Shadowdark data-model getters:
 * abilities (with active effects), attacks (incl. the att.item fallback and
 * custom attack buckets), slots / free-carry, spells (tier/name order, lost
 * state, populated notes), overflow, XSS-inert notes, and template
 * field-contract consistency against the shipped field manifest.
 *
 * buildFieldValues sources everything from the model's own getters and the
 * derived document — deliberately NOT actor.sheet.getData() — so the mocks
 * mirror that contract. No pdf-lib / Foundry runtime is loaded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFieldValues, _internals } from "../scripts/pdf-export/pdf-sheet-export.mjs";

const MANIFEST = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL("../assets/pdf/shadowdark-character-sheet-fields.json", import.meta.url)), "utf8"));
const MANIFEST_IDS = new Set(MANIFEST.fields.map((f) => f.id));

// ── shared Foundry-global stubs (buildFieldValues reads these at call time) ──
function installGlobals(uuidMap = {}) {
  const prev = {
    fromUuid: globalThis.fromUuid, fromUuidSync: globalThis.fromUuidSync, CONFIG: globalThis.CONFIG,
  };
  globalThis.fromUuid = async (u) => uuidMap[u] ?? null;
  globalThis.fromUuidSync = (u) => uuidMap[u] ?? null;
  globalThis.CONFIG = {
    SHADOWDARK: {
      RANGES: { near: "Near", close: "Close", self: "Self", far: "Far" },
      DURATION_TYPES: { focus: "Focus", instant: "Instant", days: "Days", rounds: "Rounds" },
    },
  };
  return () => Object.assign(globalThis, prev);
}

function ability(value, mod) { return { value, mod }; }

function makeActor(over = {}) {
  const classUuid = "Compendium.shadowdark.classes.Item.fighter";
  const uuidMap = {
    [classUuid]: { name: "Fighter", system: { spellcasting: { ability: "wis" }, hitPoints: "d8" } },
    ...(over.uuidMap ?? {}),
  };
  const sys = {
    level: { value: 3, xp: 12 },
    luck: over.luck ?? { available: false },
    class: classUuid,
    ancestry: "Dwarf",
    alignment: "lawful",
    background: "Soldier",
    deity: "Saint Terragnis",
    abilities: {
      str: ability(17, 3), dex: ability(12, 1), con: ability(13, 1),
      int: ability(8, -1), wis: ability(10, 0), cha: ability(9, -1),
    },
    attributes: { hp: { value: 20, max: 24 }, ac: { value: 15, tooltips: "10 + 3 leather + 2 shield" } },
    coins: { gp: 100, sp: 5, cp: 9 },
    slots: 17,
    notes: over.notes ?? "",
    getAttacks: async () => over.attacks ?? { melee: [], ranged: [] },
    getSlotUsage: async () => over.slotUsage ?? { total: 6 },
    getTitle: async () => over.title ?? "Warrior",
    getLanguageItems: async () => over.langItems ?? [{ name: "Common" }, { name: "Dwarvish" }],
    ...(over.sys ?? {}),
  };
  return { name: over.name ?? "Naugrim", system: sys, items: over.items ?? [], uuidMap };
}

test("core identity + abilities come from the derived model (active-effect values)", async () => {
  const actor = makeActor();
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text, checks } = await buildFieldValues(actor);
    assert.equal(text.name, "Naugrim");
    assert.equal(text.level, "3");
    assert.equal(text.xp, "12");
    assert.equal(text.xp_next, "30");
    assert.equal(text.class, "Fighter");         // from resolved class doc
    assert.equal(text.ancestry, "Dwarf");
    assert.equal(text.alignment, "Lawful");
    assert.equal(text.background, "Soldier");
    assert.equal(text.deity, "Saint Terragnis");
    assert.equal(text.title, "Warrior");
    assert.equal(text.str, "17");
    assert.equal(text.str_mod, "+3");            // ASI'd value + signed mod
    assert.equal(text.int_mod, "-1");
    assert.equal(text.hp, "20");
    assert.equal(text.hp_max, "24");
    assert.equal(text.ac, "15");
    assert.equal(text.gp, "100");
    assert.equal(text.luck, "");                 // no luck ⇒ blank numeric field
    assert.equal("luck" in checks, false);       // luck is a number field now, not a checkbox
    assert.equal(text.renown, "");               // no renown ⇒ blank numeric field
    assert.equal(text.languages, "Common, Dwarvish");
  } finally { restore(); }
});

test("luck renders as a number: base token ⇒ 1, pulp remaining ⇒ count, none ⇒ blank", async () => {
  const cases = [
    { luck: { available: true, remaining: 0 }, expected: "1" },   // base rule, has token
    { luck: { available: false, remaining: 0 }, expected: "" },   // base rule, spent ⇒ blank
    { luck: { available: true, remaining: 3 }, expected: "3" },   // pulp mode, 3 remaining
    { luck: { available: false, remaining: 0 }, expected: "" },   // pulp mode, none ⇒ blank
  ];
  for (const { luck, expected } of cases) {
    const actor = makeActor({ luck });
    const restore = installGlobals(actor.uuidMap);
    try {
      const { text, checks } = await buildFieldValues(actor);
      assert.equal(text.luck, expected);
      assert.equal("luck" in checks, false);
    } finally { restore(); }
  }
});

test("renown renders as a number: a value ⇒ the count, 0/unset ⇒ blank", async () => {
  const cases = [
    { renown: 4, expected: "4" },
    { renown: 0, expected: "" },     // 0 renown ⇒ blank, matching luck
    { renown: undefined, expected: "" },
  ];
  for (const { renown, expected } of cases) {
    const actor = makeActor({ sys: { renown } });
    const restore = installGlobals(actor.uuidMap);
    try {
      const { text } = await buildFieldValues(actor);
      assert.equal(text.renown, expected);
    } finally { restore(); }
  }
});

test("attacks: att.item fallback, UUID lookup, and custom buckets are all mapped", async () => {
  const weaponUuid = "Compendium.world.items.Item.longsword";
  const actor = makeActor({
    uuidMap: { [weaponUuid]: { name: "Longsword" } },
    attacks: {
      // 1) already-resolved item on the entry (no itemUuid) — the #9 fallback
      melee: [{ item: { name: "Razor Chain" }, mainRoll: { bonus: "4" }, damageRoll: { formula: "1d6 + 1" }, attack: { range: "near" } }],
      // 2) resolved via itemUuid
      ranged: [{ itemUuid: weaponUuid, mainRoll: { bonus: " + 2" }, damageRoll: { formula: "d8" }, range: "far" }],
      // 3) a CUSTOM bucket that must not be silently dropped
      unarmed: [{ name: "Fist", mainRoll: { bonus: "0" }, damageRoll: { formula: "1d1" } }],
    },
  });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.equal(text.attack_1_name, "Razor Chain");
    assert.equal(text.attack_1_bonus, "+4");
    assert.equal(text.attack_1_damage, "1d6+1");
    assert.equal(text.attack_1_range, "Near");
    assert.equal(text.attack_2_name, "Longsword");   // via fromUuidSync
    assert.equal(text.attack_2_bonus, "+2");
    assert.equal(text.attack_2_damage, "d8");
    assert.equal(text.attack_2_range, "Far");
    assert.equal(text.attack_3_name, "Fist");        // custom bucket kept
  } finally { restore(); }
});

test("slots + free-carry: getSlotUsage total, trinkets/0-slot to free box", async () => {
  const items = [
    { type: "Basic", name: "Rope", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } },
    { type: "Basic", name: "Torches", system: { quantity: 4, slots: { per_slot: 1, free_carry: 0, slots_used: 2 } } },
    { type: "Basic", name: "Lucky Trinket", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } },
    { type: "Basic", name: "Feather", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 0 } } },
    { type: "Basic", name: "Stashed Loot", system: { stashed: true, slots: { slots_used: 1 } } },
  ];
  const actor = makeActor({ items, slotUsage: { total: 9 } });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.equal(text.gear_slots_used, "9");     // model total wins over local sum
    assert.equal(text.gear_slots_max, "17");
    assert.equal(text.gear_1, "Rope");
    assert.equal(text.gear_2, "Torches (x4) — 8 slots");
    assert.equal(text.gear_3, undefined, "trinket/0-slot/stashed do not take gear lines");
    assert.match(text.free_carry, /Lucky Trinket/);
    assert.match(text.free_carry, /Feather/);
    assert.doesNotMatch(text.free_carry, /Stashed Loot/, "stashed excluded entirely");
  } finally { restore(); }
});

test("spells: tier-then-name order, lost state, populated safe-text notes", async () => {
  const items = [
    { type: "Spell", name: "Zephyr", system: { tier: 2, range: "far", duration: { type: "rounds", value: 5 }, lost: false, description: "<p>You conjure a strong wind.</p><p>It knocks foes prone.</p>" } },
    { type: "Spell", name: "Alarm", system: { tier: 1, range: "close", duration: { type: "focus", value: 1 }, lost: true, description: "<p>A ward that rings when crossed. Second sentence ignored.</p>" } },
    { type: "Spell", name: "Burn", system: { tier: 1, range: "near", duration: { type: "instant" }, lost: false, description: "" } },
  ];
  const actor = makeActor({ items });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text, checks } = await buildFieldValues(actor);
    // sorted: tier 1 Alarm, tier 1 Burn, tier 2 Zephyr
    assert.equal(text.spell_1_name, "Alarm");
    assert.equal(text.spell_2_name, "Burn");
    assert.equal(text.spell_3_name, "Zephyr");
    assert.equal(text.spell_1_tier, "1");
    assert.equal(text.spell_1_range, "Close");
    assert.equal(text.spell_1_duration, "Focus");         // non-numeric duration = bare label
    assert.equal(text.spell_3_duration, "5 Rounds");
    assert.equal(checks.spell_1_lost, true);
    assert.equal(checks.spell_2_lost, false);
    // notes are safe plain text — first sentence, no HTML
    assert.equal(text.spell_1_notes, "A ward that rings when crossed.");
    assert.equal(text.spell_3_notes, "You conjure a strong wind.");
    assert.doesNotMatch(text.spell_1_notes, /[<>]/);
  } finally { restore(); }
});

test("overflow: extra attacks/spells summarised in notes, capped fields not exceeded", async () => {
  const melee = Array.from({ length: 7 }, (_, i) => ({ name: `Atk${i}`, mainRoll: { bonus: "0" }, damageRoll: { formula: "1d4" } }));
  const spells = Array.from({ length: 18 }, (_, i) => ({ type: "Spell", name: `Spell${String(i).padStart(2, "0")}`, system: { tier: 1, range: "self", duration: { type: "instant" }, lost: false, description: "desc." } }));
  const gear = Array.from({ length: 22 }, (_, i) => ({ type: "Basic", name: `Item${i}`, system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } }));
  const actor = makeActor({ attacks: { melee, ranged: [] }, items: [...spells, ...gear] });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.equal(text.attack_5_name, "Atk4");
    assert.equal(text.attack_6_name, undefined, "only 5 attack rows on the sheet");
    assert.equal(text.spell_16_name !== undefined, true);
    assert.equal(text.spell_17_name, undefined, "only 16 spell rows on the sheet");
    assert.equal(text.gear_20 !== undefined, true);
    assert.equal(text.gear_21, undefined, "only 20 gear lines");
    assert.match(text.notes, /2 more attack/);
    assert.match(text.notes, /2 more spell/);
    assert.match(text.notes, /Gear overflow/);
  } finally { restore(); }
});

test("talents vs features split by talentClass: acquired on page 1, class/ancestry (with text) on page 2, no overlap", async () => {
  const items = [
    { type: "Talent", name: "Ambitious", system: { talentClass: "ancestry", description: "<p>One extra talent roll at 1st level.</p>" } },
    { type: "Talent", name: "Grit", system: { talentClass: "class", description: "<p>Reroll a failed check once per day.</p>" } },
    { type: "Talent", name: "+1 to Melee Attacks", system: { talentClass: "level", description: "" } },
    { type: "Talent", name: "Force Morale Check", system: { talentClass: "patronBoon", description: "<p>1/day, force a morale check.</p>" } },
    { type: "Talent", name: "Legacy Talent", system: { description: "<p>Old data, no talentClass.</p>" } },
  ];
  const actor = makeActor({ items });        // default ancestry Dwarf, class Fighter (hit die d8)
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    // page 1 — acquired talents only (level roll, patron boon, untagged legacy)
    assert.match(text.talents, /\+1 to Melee Attacks/);
    assert.match(text.talents, /Force Morale Check/);
    assert.match(text.talents, /Legacy Talent/);          // untagged ⇒ acquired bucket
    assert.doesNotMatch(text.talents, /Ambitious/);        // ancestry feature not here
    assert.doesNotMatch(text.talents, /Grit/);             // class feature not here
    // page 2 — class/ancestry features, grouped, WITH their descriptions
    assert.match(text.features, /ANCESTRY: Dwarf/);
    assert.match(text.features, /Ambitious — One extra talent roll at 1st level\./);
    assert.match(text.features, /CLASS: Fighter \(hit die d8\)/);
    assert.match(text.features, /Grit — Reroll a failed check once per day\./);
    assert.doesNotMatch(text.features, /Melee Attacks/);   // acquired talent not here
    assert.doesNotMatch(text.features, /Force Morale/);
  } finally { restore(); }
});

test("notes are XSS-inert: hostile bio HTML is reduced to plain text (no tags/handlers)", async () => {
  const actor = makeActor({ notes: `<img src=x onerror="alert(document.cookie)">hello<script>steal()</script>` });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text } = await buildFieldValues(actor);
    assert.match(text.notes, /hello/);
    assert.doesNotMatch(text.notes, /<img/i);
    assert.doesNotMatch(text.notes, /onerror/i);
    assert.doesNotMatch(text.notes, /<script/i);
  } finally { restore(); }
});

test("htmlToText prefers an inert DOMParser when present (never innerHTML)", () => {
  let usedParser = false;
  const prev = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(html) {
      usedParser = true;
      // minimal inert stand-in: expose body.textContent as the de-tagged string
      const stripped = String(html).replace(/<[^>]*>/g, "");
      const nodeList = { forEach() {} };
      return { querySelectorAll: () => nodeList, body: { textContent: stripped } };
    }
  };
  try {
    const out = _internals.htmlToText(`<p>Hi <b>there</b></p>`);
    assert.equal(usedParser, true, "DOMParser.parseFromString was used");
    assert.equal(out, "Hi there");
  } finally { globalThis.DOMParser = prev; }
});

test("template field-contract: every produced id exists in the manifest; all 16 spell_notes fill", async () => {
  const spells = Array.from({ length: 16 }, (_, i) => ({ type: "Spell", name: `S${String(i).padStart(2, "0")}`, system: { tier: 1, range: "self", duration: { type: "instant" }, lost: false, description: "A short spell effect." } }));
  const actor = makeActor({
    attacks: { melee: [{ name: "Sword", mainRoll: { bonus: "1" }, damageRoll: { formula: "1d6" }, attack: { range: "near" } }], ranged: [] },
    items: [
      ...spells,
      { type: "Talent", name: "Grit", system: { talentClass: "class" } },
      { type: "Language", name: "Common" },
      { type: "Basic", name: "Rope", system: { quantity: 1, slots: { per_slot: 1, free_carry: 0, slots_used: 1 } } },
    ],
  });
  const restore = installGlobals(actor.uuidMap);
  try {
    const { text, checks } = await buildFieldValues(actor);
    for (const id of [...Object.keys(text), ...Object.keys(checks)])
      assert.ok(MANIFEST_IDS.has(id), `produced field "${id}" is declared in the template manifest`);
    for (let r = 1; r <= 16; r++)
      assert.ok(text[`spell_${r}_notes`] && text[`spell_${r}_notes`].length > 0, `spell_${r}_notes populated`);
  } finally { restore(); }
});
