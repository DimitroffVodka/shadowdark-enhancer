// Regression tests for the Weapon/Armor stat parser (gear-parser.parseGear) and
// its handoff to item-importer.buildItemData. Pure — no Foundry globals; the
// property NAME → UUID resolution is commit-time (Foundry-bound, live-verified,
// not here). Fixtures mirror the Western Reaches gear-table SHAPE with synthetic
// values — no book content ships in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGear, WR_ARMOR_CODES, WR_WEAPON_CODES } from "../scripts/importer/items/gear-parser.mjs";
import { buildItemData } from "../scripts/importer/items/item-importer.mjs";

// Single-record helper — asserts the paste produced EXACTLY one record, so a
// splitter that collapses rows (or mints phantom extras) fails loudly here
// instead of silently feeding [0] to the assertions (pre-push review 2026-07-14).
const one = (text, kind) => {
  const recs = parseGear(text, kind);
  assert.equal(recs.length, 1, `expected exactly 1 record, got ${recs.length}`);
  return recs[0];
};

test("reflowed shield: slots vs AC-modifier disambiguation + C/S codes", () => {
  // One field per line (PDF-viewer copy shape): name / cost / slots / +mod / codes / material.
  const { draft, warnings } = one([
    "Round shield,",
    "60 gp",
    " 0",      // bare < 10 → slots
    " +2",     // leading + → ac.modifier (shield bonus)
    " C, S",   // Carried + Sundering
    "mithral",
  ].join("\n"), "Armor");

  assert.equal(draft.type, "Armor");
  assert.deepEqual(draft.cost, { gp: 60, sp: 0, cp: 0 });
  assert.equal(draft.slots.slots_used, 0);
  assert.equal(draft.ac.base, 0);
  assert.equal(draft.ac.modifier, 2);
  assert.equal(draft.ac.attribute, "");              // shields carry no bonus attribute
  assert.equal(draft.baseArmor, "round-shield");     // slug of the UNDERLYING armor (system convention)
  assert.equal(draft.name, "Mithral Round shield");
  assert.deepEqual(draft.altNames, ["Round shield"]); // pre-fold spelling anchors desc matching
  assert.deepEqual(draft.propNames, ["Occupies One Hand", "Sundering"]);
  assert.deepEqual(warnings, []);
});

test("body armor: bare number >= 10 is AC base, dex attribute defaulted, L code", () => {
  const { draft } = one([
    "Chain shirt",
    "40 gp",
    "1",       // slots
    "13",      // AC base
    "L",       // Loud → Disadvantage/Stealth
  ].join("\n"), "Armor");
  assert.equal(draft.ac.base, 13);
  assert.equal(draft.ac.modifier, 0);
  assert.equal(draft.ac.attribute, "dex");
  assert.equal(draft.slots.slots_used, 1);
  assert.deepEqual(draft.propNames, ["Disadvantage/Stealth"]);
});

test("Mount (M) code has no core property → flagged, not applied", () => {
  const { draft, warnings } = one("Barding\n30 gp\n2\n11\nM", "Armor");
  assert.deepEqual(draft.propNames, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Mount.*\(M\).*no core Shadowdark property/);
});

test("unknown armor code is flagged and left off", () => {
  const { draft, warnings } = one("Oddplate\n50 gp\n2\n15\nZ", "Armor");
  assert.deepEqual(draft.propNames, []);
  assert.match(warnings[0], /Unknown armor property code "Z"/);
});

test("inline weapon: versatile damage pair, range, code F", () => {
  const { draft } = one("Bastard sword, 10 gp, 1 slot, d8/d10, close, F, V", "Weapon");
  assert.equal(draft.type, "Weapon");
  assert.deepEqual(draft.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(draft.range, "close");
  assert.equal(draft.wtype, "melee");
  assert.deepEqual(draft.propNames, ["Finesse", "Versatile"]);
});

test("two-handed-only weapon puts single die in twoHanded; far range → ranged", () => {
  const { draft } = one("Crossbow, 8 gp, 1 slot, d6, far, Lo, 2H", "Weapon");
  assert.deepEqual(draft.damage, { oneHanded: "", twoHanded: "d6" });
  assert.equal(draft.range, "far");
  assert.equal(draft.wtype, "ranged");
  assert.deepEqual(draft.propNames, ["Loading", "Two-Handed"]);
});

test("plain one-handed weapon, no properties", () => {
  const { draft } = one("Longsword, 9 gp, 1 slot, d8, close", "Weapon");
  assert.deepEqual(draft.damage, { oneHanded: "d8", twoHanded: "" });
  assert.deepEqual(draft.propNames, []);
});

test("multi-die siege damage kept verbatim (3d6)", () => {
  const { draft } = one("Ballista, 150 gp, ranged, 3d6, far", "Weapon");
  assert.equal(draft.damage.oneHanded === "3d6" || draft.damage.twoHanded === "3d6", true);
  assert.equal(draft.wtype, "ranged");
});

test("buildItemData maps an Armor draft to the ArmorSD system shape", () => {
  const { draft } = one("Round shield,\n60 gp\n0\n+2\nC, S\nmithral", "Armor");
  draft.properties = ["Compendium.shadowdark.properties.Item.CARRIED", "Compendium.shadowdark.properties.Item.SUND"];
  const data = buildItemData(draft);
  assert.equal(data.type, "Armor");
  assert.deepEqual(data.system.ac, { attribute: "", base: 0, modifier: 2 });
  assert.equal(data.system.baseArmor, "round-shield");
  assert.equal(data.system.slots.slots_used, 0);
  assert.deepEqual(data.system.properties, draft.properties);
  assert.equal("treasure" in data.system, false);   // Armor never carries treasure
});

test("buildItemData maps a Weapon draft to the WeaponSD system shape", () => {
  const { draft } = one("Bastard sword, 10 gp, 1 slot, d8/d10, close, V", "Weapon");
  draft.properties = ["Compendium.shadowdark.properties.Item.VERS"];
  const data = buildItemData(draft);
  assert.equal(data.type, "Weapon");
  assert.deepEqual(data.system.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(data.system.range, "close");
  assert.equal(data.system.type, "melee");
  assert.deepEqual(data.system.properties, draft.properties);
});

test("buildItemData: Basic gear defaults treasure:false (no longer stamps true)", () => {
  const data = buildItemData({ name: "Rope, 60'", type: "Basic", cost: { gp: 1, sp: 0, cp: 0 } });
  assert.equal(data.system.treasure, false);
});

test("legend maps are the documented WR codes", () => {
  assert.equal(WR_ARMOR_CODES.C, "Occupies One Hand");
  assert.equal(WR_ARMOR_CODES.S, "Sundering");
  assert.equal(WR_ARMOR_CODES.M, null);
  assert.equal(WR_WEAPON_CODES["2H"], "Two-Handed");
});

// ── Record splitting: runs of inline rows (pre-push review blockers, 2026-07-14) ──

test("two inline weapon rows in one paste stay two records", () => {
  const recs = parseGear([
    "Bastard sword, 10 gp, 1 slot, d8/d10, close, V",
    "Crossbow, 8 gp, 1 slot, d6, far, Lo, 2H",
  ].join("\n"), "Weapon");
  assert.equal(recs.length, 2);
  assert.equal(recs[0].draft.name, "Bastard sword");
  assert.deepEqual(recs[0].draft.cost, { gp: 10, sp: 0, cp: 0 });
  assert.deepEqual(recs[0].draft.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(recs[1].draft.name, "Crossbow");
  assert.deepEqual(recs[1].draft.cost, { gp: 8, sp: 0, cp: 0 });
  assert.deepEqual(recs[1].draft.damage, { oneHanded: "", twoHanded: "d6" });
});

test("three inline rows split even when one has no numeric cost (Varies)", () => {
  const recs = parseGear([
    "Longsword, 9 gp, 1 slot, d8, close",
    "Siege ram, Varies, 2 slots, 2d10, close, 2H",
    "Shortbow, 6 gp, 1 slot, d4, far, 2H",
  ].join("\n"), "Weapon");
  assert.equal(recs.length, 3);
  assert.equal(recs[1].draft.name, "Siege ram");
  assert.equal(recs[1].draft.damage.twoHanded, "2d10");
  assert.deepEqual(recs[1].draft.cost, { gp: 0, sp: 0, cp: 0 });
  assert.ok(recs[1].warnings.some((w) => /No cost found/.test(w)));
});

test("two inline armor rows stay two records with their own AC; em-dash cell is silent", () => {
  const recs = parseGear([
    "Leather armor, 10 gp, 1 slot, 11, —",
    "Chainmail, 60 gp, 2 slots, 13, L, R",
  ].join("\n"), "Armor");
  assert.equal(recs.length, 2);
  assert.equal(recs[0].draft.ac.base, 11);
  assert.deepEqual(recs[0].warnings, []);            // "—" means none, not noise
  assert.equal(recs[1].draft.ac.base, 13);
  assert.deepEqual(recs[1].draft.propNames, ["Disadvantage/Stealth", "Disadvantage/Swim"]);
});

test("mixed paste: blank-separated reflowed record + a run of inline rows", () => {
  const recs = parseGear([
    "Round shield,", "60 gp", "0", "+2", "C, S",
    "",
    "Leather armor, 10 gp, 1 slot, 11",
    "Chainmail, 60 gp, 2 slots, 13, L",
  ].join("\n"), "Armor");
  assert.equal(recs.length, 3);
  assert.equal(recs[0].draft.ac.modifier, 2);
  assert.equal(recs[1].draft.ac.base, 11);
  assert.equal(recs[2].draft.ac.base, 13);
});

test("a wrapped property continuation rejoins its inline row", () => {
  const recs = parseGear([
    "Warhammer, 10 gp, 1 slot, d8/d10, close,",
    "V, S",
    "Dagger, 1 gp, 1 slot, d4, close, F, Th",
  ].join("\n"), "Weapon");
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0].draft.propNames, ["Versatile", "Sundering"]);
  assert.deepEqual(recs[0].draft.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(recs[1].draft.name, "Dagger");
});

// ── Record hygiene: strays are dropped + reported, never minted (STATUS 07-14
//    observed phantoms: an item named "+" and one named "") ──

test("stray symbol/number blocks are dropped and reported, never minted as items", () => {
  const dropped = [];
  const recs = parseGear(
    "Bastard sword, 10 gp, 1 slot, d8/d10, close, V\n\n+\n\n+2\n\n112\n\n2H\n\nCrossbow, 8 gp, 1 slot, d6, far, Lo, 2H",
    "Weapon",
    { onDrop: (text, reason) => dropped.push({ text, reason }) },
  );
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.draft.name), ["Bastard sword", "Crossbow"]);
  assert.equal(dropped.length, 4);
});

test("a lone one-word block next to real rows is dropped; a name-only paste is kept", () => {
  const dropped = [];
  const recs = parseGear("Chain shirt, 40 gp, 1 slot, 13, L\n\nmithral", "Armor",
    { onDrop: (text) => dropped.push(text) });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].draft.name, "Chain shirt");
  assert.deepEqual(dropped, ["mithral"]);
  // Sole content = likely a seeded/typed name → kept as a reviewable draft.
  const alone = parseGear("Longsword", "Weapon");
  assert.equal(alone.length, 1);
  assert.equal(alone[0].draft.name, "Longsword");
});

test("empty input parses to zero records", () => {
  assert.deepEqual(parseGear("", "Weapon"), []);
  assert.deepEqual(parseGear("   \n\n  ", "Armor"), []);
});

test("multiple coin denominations in one cost field", () => {
  const { draft } = one("Fine scabbard, 1 gp 5 sp, 1 slot, d4, close", "Weapon");
  assert.deepEqual(draft.cost, { gp: 1, sp: 5, cp: 0 });
});

test("a prose line mentioning a price parses as one flagged record, not a split", () => {
  const recs = parseGear(
    "The smith swears every blade, even the cheap ones, is worth 10 gp at least",
    "Weapon");
  assert.equal(recs.length, 1);
  assert.ok(recs[0].warnings.length >= 1);
});

test("numbers and apostrophes in a legitimate name survive", () => {
  const { draft } = one("Sma'kar 2-blade, 12 gp, 1 slot, d6, close, F", "Weapon");
  assert.equal(draft.name, "Sma'kar 2-blade");
  assert.deepEqual(draft.damage, { oneHanded: "d6", twoHanded: "" });
});

// ── Book stat rows: space-separated columns, the shape the single-column PDF
//    extract of the WR tables actually yields (live-verified 2026-07-14).
//    Synthetic values — shape only, no book content. ──

test("weapon stat-row table: rows parse; header, footer, and title drop", () => {
  const dropped = [];
  const recs = parseGear([
    "Weapons",
    "Weapon Cost Type Range Damage Properties",
    "Falchion 12 gp M C 1d8 2H, F",
    "Blowpipe 5 gp R N 1 Sn",
    "Skirmish axe 2 gp M/R C/N 1d6 F, Th",
    "Zweihander 12 gp M C 1d12 2H, 2 slots",
    "110",
    "Longknife 9 gp M C 1d8 -",
  ].join("\n"), "Weapon", { onDrop: (text, reason) => dropped.push({ text, reason }) });
  assert.equal(recs.length, 5);
  const byName = Object.fromEntries(recs.map((r) => [r.draft.name, r]));
  // 2H-only → single die lands in twoHanded.
  assert.deepEqual(byName["Falchion"].draft.damage, { oneHanded: "", twoHanded: "d8" });
  assert.deepEqual(byName["Falchion"].draft.propNames, ["Two-Handed", "Finesse"]);
  assert.equal(byName["Falchion"].draft.wtype, "melee");
  assert.equal(byName["Falchion"].draft.range, "close");
  // Flat damage ("1") is not a die: review flag, and NOT eaten as slots.
  assert.deepEqual(byName["Blowpipe"].draft.damage, { oneHanded: "", twoHanded: "" });
  assert.equal(byName["Blowpipe"].draft.slots.slots_used, 1);
  assert.ok(byName["Blowpipe"].warnings.some((w) => /No damage die found/.test(w)));
  assert.ok(byName["Blowpipe"].warnings.some((w) => /Sniper.*\(Sn\).*no core Shadowdark property/.test(w)));
  // Dual codes keep the FIRST as stored value; Th carries the thrown use.
  assert.equal(byName["Skirmish axe"].draft.wtype, "melee");
  assert.equal(byName["Skirmish axe"].draft.range, "close");
  assert.deepEqual(byName["Skirmish axe"].draft.propNames, ["Finesse", "Thrown"]);
  // A trailing "2 slots" note in the props column sets slots.
  assert.equal(byName["Zweihander"].draft.slots.slots_used, 2);
  // "-" props → none, and a clean row carries no warnings.
  assert.deepEqual(byName["Longknife"].draft.propNames, []);
  assert.deepEqual(byName["Longknife"].draft.damage, { oneHanded: "d8", twoHanded: "" });
  assert.deepEqual(byName["Longknife"].warnings, []);
  assert.deepEqual(dropped.map((d) => d.text), ["Weapons", "Weapon Cost Type Range Damage Properties", "110"]);
});

test("weapon stat row: WR-only codes (C/D/M/O/Sn) flag with their book label", () => {
  const recs = parseGear([
    "War lance 15 gp M C 1d12 C, D, M, 3 slots",
    "Obsidian club 5 cp M C 1d4 O",
  ].join("\n"), "Weapon");
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0].draft.propNames, []);
  assert.equal(recs[0].draft.slots.slots_used, 3);
  assert.ok(recs[0].warnings.some((w) => /Charge.*\(C\)/.test(w)));
  assert.ok(recs[0].warnings.some((w) => /Devastating.*\(D\)/.test(w)));
  assert.ok(recs[0].warnings.some((w) => /Mounted.*\(M\)/.test(w)));
  assert.ok(recs[1].warnings.some((w) => /Obsidian.*\(O\)/.test(w)));
});

test("weapon stat row: a dash cost (unarmed strikes) parses with a cost review flag", () => {
  const recs = parseGear([
    "Brawling - M C 1d4 0 slots",
    "Longknife 9 gp M C 1d8 -",
  ].join("\n"), "Weapon");
  assert.equal(recs.length, 2);
  assert.equal(recs[0].draft.name, "Brawling");
  assert.deepEqual(recs[0].draft.damage, { oneHanded: "d4", twoHanded: "" });
  assert.equal(recs[0].draft.slots.slots_used, 0);
  assert.deepEqual(recs[0].draft.cost, { gp: 0, sp: 0, cp: 0 });
  assert.ok(recs[0].warnings.some((w) => /No cost found/.test(w)));
});

test("weapon stat row: reach notation (2x) surfaces as a review flag, row still parses", () => {
  const recs = parseGear([
    "Halberd 10 gp M 2x C 1d10 2H, 2 slots",
    "Longknife 9 gp M C 1d8 -",
  ].join("\n"), "Weapon");
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0].draft.damage, { oneHanded: "", twoHanded: "d10" });
  assert.equal(recs[0].draft.slots.slots_used, 2);
  assert.ok(recs[0].warnings.some((w) => /Unparsed weapon field "2x"/.test(w)));
});

test("armor stat-row table incl. the three-line mithral wrap and a comma-material row", () => {
  const dropped = [];
  const recs = parseGear([
    "Item Cost Gear Slots AC Properties",
    "Hide armor 10 gp 1 11 + DEX mod M",
    "Scalemail 60 gp 2 13 + DEX mod L, M, R",
    "Warplate 130 gp 3 15 H, L",
    "Scalemail,",
    "240 gp 1 13 + DEX mod M",
    "mithral",
    "Tower shield 15 gp 1 +2 C, S",
    "Buckler, mithral 40 gp 0 +2 C",
  ].join("\n"), "Armor", { onDrop: (text) => dropped.push(text) });
  assert.equal(recs.length, 6);
  const hide = recs[0].draft;
  assert.deepEqual(hide.cost, { gp: 10, sp: 0, cp: 0 });
  assert.equal(hide.ac.base, 11);
  assert.equal(hide.ac.attribute, "dex");   // "11 + DEX mod" → explicit DEX armor
  assert.equal(hide.baseArmor, "");         // plain armor: no base-armor slug
  assert.equal(hide.slots.slots_used, 1);
  assert.ok(recs[0].warnings.some((w) => /Mount.*\(M\).*no core Shadowdark property/.test(w)));
  assert.deepEqual(recs[1].draft.propNames, ["Disadvantage/Stealth", "Disadvantage/Swim"]);
  // Bare AC in a stat row means NO DEX (plate-style) — the book prints the
  // difference and the system stores attribute "" there.
  const plate = recs[2].draft;
  assert.equal(plate.ac.base, 15);
  assert.equal(plate.ac.attribute, "");
  const wrap = recs[3].draft;
  assert.equal(wrap.name, "Mithral Scalemail");
  assert.deepEqual(wrap.cost, { gp: 240, sp: 0, cp: 0 });
  assert.equal(wrap.ac.base, 13);
  assert.equal(wrap.ac.attribute, "dex");
  assert.equal(wrap.baseArmor, "scalemail");        // underlying armor's slug
  assert.deepEqual(wrap.altNames, ["Scalemail"]);
  assert.equal(wrap.slots.slots_used, 1);
  const tower = recs[4].draft;
  assert.equal(tower.ac.base, 0);
  assert.equal(tower.ac.modifier, 2);
  assert.deepEqual(tower.propNames, ["Occupies One Hand", "Sundering"]);
  const buckler = recs[5].draft;
  assert.equal(buckler.name, "Mithral Buckler");
  assert.equal(buckler.ac.modifier, 2);
  assert.equal(buckler.slots.slots_used, 0);
  assert.equal(buckler.baseArmor, "buckler");
  assert.deepEqual(buckler.altNames, ["Buckler, mithral", "Buckler"]);
  assert.deepEqual(dropped, ["Item Cost Gear Slots AC Properties"]);
});

test("isolated and blank-separated stat rows parse without a run", () => {
  // A single full stat row on its own is decisive.
  const [lone] = parseGear("Falchion 12 gp M C 1d8 2H, F", "Weapon");
  assert.equal(lone.draft.name, "Falchion");
  assert.deepEqual(lone.draft.damage, { oneHanded: "", twoHanded: "d8" });
  assert.deepEqual(lone.draft.propNames, ["Two-Handed", "Finesse"]);
  const [loneArmor] = parseGear("Warplate 130 gp 3 15 H", "Armor");
  assert.equal(loneArmor.draft.ac.base, 15);
  assert.equal(loneArmor.draft.ac.attribute, "");
  // Blank-line-separated stat rows (one per block) each parse fully.
  const recs = parseGear(
    "Falchion 12 gp M C 1d8 2H, F\n\nChakram 20 gp R N 1d6 R, Th",
    "Weapon");
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[1].draft.damage, { oneHanded: "d6", twoHanded: "" });
  assert.equal(recs[1].draft.wtype, "ranged");
});

test("a property-definitions prose block is dropped whole, not minted", () => {
  const dropped = [];
  const recs = parseGear([
    "Carried (C). This armor occupies Restrictive (R). You have",
    "one hand while using it. DISADV on checks to swim while",
    "wearing this armor.",
    "Heavy (H). You cannot swim",
  ].join("\n"), "Armor", { onDrop: (text, reason) => dropped.push(reason) });
  assert.equal(recs.length, 0);
  assert.ok(dropped.includes("prose block, not a gear record"));
});
