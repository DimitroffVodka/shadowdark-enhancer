import test from "node:test";
import assert from "node:assert/strict";
import { creatureMentions, resolveMentions, bestiaryLookup, phraseKeys, nameKeys, creatureResolver } from "../scripts/importer/adventure/adventure-creatures.mjs";
import { parseAdventurePages } from "../scripts/importer/adventure/adventure-parser.mjs";
import { _internals } from "../scripts/importer/pdf-text-extract.mjs";
import { BOLD_OPEN as O, BOLD_CLOSE as C, stripBold } from "../scripts/importer/pdf-text-utils.mjs";

// Invented data throughout.
const b = (s) => `${O}${s}${C}`;
const found = (...lines) => creatureMentions(lines);

test("a count in plain type before a bold name is the creature's number", () => {
  assert.deepEqual(found(`• ${b("People.")} 12 unruly ${b("Gribbles")} camp here.`), [{ phrase: "Gribbles", count: 12 }]);
  assert.deepEqual(found(`Four jumpy ${b("wibbets")} stand guard.`), [{ phrase: "wibbets", count: 4 }]);
  assert.deepEqual(found(`A family of 3 ${b("giant moths")} nests.`), [{ phrase: "giant moths", count: 3 }]);
});

test("a number before a plain noun, then the bold name in brackets: Two monks (acolytes)", () => {
  assert.deepEqual(found(`Two monks (${b("acolytes")}) shuffle about.`), [{ phrase: "acolytes", count: 2 }]);
});

test("a bold bullet label with its number after it", () => {
  assert.deepEqual(found(`${b("• Skeletons.")} Three. They shoot bows.`), [{ phrase: "Skeletons", count: 3 }]);
  assert.deepEqual(found(`${b("• Duergar.")} Two chip at the stone.`), [{ phrase: "Duergar", count: 2 }]);
});

test("things that are not a head count place nothing", () => {
  assert.deepEqual(found(`${b("Gribbles")} wander.`), [], "no number at all");
  assert.deepEqual(found(`2:6 chance of 1d4 ${b("Gribbles")} here.`), [], "a chance and a die roll are the GM's");
  assert.deepEqual(found(`Hear voices from Area 4 if ${b("Gribbles")} are there.`), [], "Area 4 is a place");
  assert.deepEqual(found(`DC 15 to spot the ${b("trapdoor")}.`), [], "a DC is not a count");
  assert.deepEqual(found(`${b("• Gribbles.")} Clove, Gabby, Merv.`), [], "names are not a count");
});

test("a creature said to be in another Area is not in this one", () => {
  assert.deepEqual(found(`Four captive ${b("wibbets")} lurk in Area 46 and beg.`), []);
  assert.deepEqual(found(`(three ${b("Gribbles")} from Area 4 hear)`), []);
});

test("the larger count wins when a room says the same creature twice", () => {
  assert.deepEqual(found(`Four ${b("Gribbles")} guard.`, `${b("• Gribbles.")} Six.`), [{ phrase: "Gribbles", count: 6 }]);
});

test("phraseKeys: every singular a phrase can be", () => {
  assert.ok(phraseKeys("giant ants").includes("giant ant"));
  assert.ok(phraseKeys("zombies").includes("zombie"));
  assert.ok(phraseKeys("wolves").includes("wolf"));
  assert.ok(phraseKeys("goblinmen").includes("goblinman"));
  assert.ok(phraseKeys("foxes").includes("fox"));
  assert.ok(phraseKeys("oozes").includes("ooze"));
  assert.equal(phraseKeys("fungus")[0], "fungus", "the literal reading comes first");
});

test("nameKeys: the system's 'Rat, Giant' is also 'giant rat'", () => {
  assert.deepEqual(nameKeys("Rat, Giant"), ["rat giant", "giant rat"]);
  assert.deepEqual(nameKeys("Elemental, Earth (Lesser)"), ["elemental earth", "earth elemental"]);
  assert.deepEqual(nameKeys("Goblin"), ["goblin"]);
});

test("resolveMentions: names the bestiary has become creatures; the rest are left out", () => {
  const lookup = bestiaryLookup(["Gribble", "Rat, Giant", "Zombie"]);
  const r = resolveMentions([
    { phrase: "Gribbles", count: 12 }, { phrase: "giant rats", count: 3 }, { phrase: "zombies", count: 2 },
    { phrase: "People", count: 1 }, { phrase: "gribble", count: 5 },
  ], lookup);
  assert.deepEqual(r.creatures, [
    { monster: "Gribble", count: 12 }, { monster: "Rat, Giant", count: 3 }, { monster: "Zombie", count: 2 },
  ]);
  assert.deepEqual(r.unknown, ["People"]);
});

test("the parser keeps a marked copy of each body line, headings matched on the plain text", () => {
  const lines = [`${b("1. ENTRY HALL")}`, `Four ${b("Gribbles")} guard.`, `${b("2. Cellar.")} A damp room with 3 ${b("wibbets")}.`, "more"];
  const caps = parseAdventurePages([lines.slice(0, 2)], { style: "caps" }).locations;
  assert.equal(caps[0].num, 1);
  assert.deepEqual(caps[0].bodyLines, ["Four Gribbles guard."]);
  assert.deepEqual(caps[0].boldLines, [`Four ${b("Gribbles")} guard.`]);
  const inline = parseAdventurePages([[`${b("1. Hall.")} Four ${b("Gribbles")} guard.`, `${b("2. Cellar.")} A damp room with 3 ${b("wibbets")}.`, "more"]], { style: "inline" }).locations;
  assert.deepEqual(inline.map((l) => l.bodyLines), [["Four Gribbles guard."], ["A damp room with 3 wibbets.", "more"]]);
  assert.deepEqual(inline[0].boldLines, [`Four ${b("Gribbles")} guard.`], "the bold heading does not leak into the body");
  assert.equal(stripBold(inline[1].boldLines[0]), inline[1].bodyLines[0]);
  assert.deepEqual(creatureMentions(inline[1].boldLines), [{ phrase: "wibbets", count: 3 }]);
});

test("the extractor brackets bold items only when they are flagged, and joins neighbours", () => {
  const item = (str, x, bold) => ({ str, transform: [10, 0, 0, 10, x, 700], width: str.length * 5, height: 10, ...(bold ? { bold: true } : {}) });
  const row = [item("12 unruly", 0), item("Giant", 50, true), item("ants", 80, true), item("camp.", 110)];
  const { lines } = _internals.layoutPageItems(row, 600, "auto");
  assert.equal(lines.length, 1);
  assert.equal(lines[0], `12 unruly ${b("Giant ants")} camp.`);
  const plain = _internals.layoutPageItems(row.map((i) => { const c = { ...i }; delete c.bold; return c; }), 600, "auto").lines;
  assert.equal(plain[0], "12 unruly Giant ants camp.", "unflagged items are exactly as before");
});

// ─── Links in the filed text ─────────────────────────────────────────────────

const INDEX = [
  { name: "Gribble", uuid: "Compendium.x.Actor.GRIB", type: "NPC" },
  { name: "Moth, Giant", uuid: "Compendium.x.Actor.MOTH", type: "NPC" },
  { name: "Wibbet Cart", uuid: "Compendium.x.Actor.CART", type: "Vehicle" },   // not a creature
];

test("creatureResolver: a bold phrase to the creature's uuid; singular, plural and the system's 'Moth, Giant' all answer; a vehicle never does", () => {
  const r = creatureResolver(INDEX);
  assert.equal(r("Gribbles"), "Compendium.x.Actor.GRIB");
  assert.equal(r("gribble"), "Compendium.x.Actor.GRIB");
  assert.equal(r("giant moths"), "Compendium.x.Actor.MOTH");
  assert.equal(r("wibbet carts"), undefined);
  assert.equal(r("Treasure"), undefined);
  assert.equal(creatureResolver([])("Gribbles"), undefined);
});

test("creatureResolver: an alias names a creature the book calls something else, and the bestiary's own name still wins", () => {
  const r = creatureResolver(INDEX, { Pixie: "Gribble", gribble: "Moth, Giant" });
  assert.equal(r("pixies"), "Compendium.x.Actor.GRIB");
  assert.equal(r("Gribbles"), "Compendium.x.Actor.GRIB");
  assert.equal(creatureResolver(INDEX, { pixie: "Nobody" })("pixies"), undefined, "an alias to a creature the world lacks links nothing");
});

test("creatureResolver: a book calls an imported NPC by its first name, and by its possessive; the system's creatures and a shared first name do not", () => {
  const index = [
    { name: "Gordock Breeg", uuid: "Compendium.world.x.Actor.GORD", type: "NPC" },
    { name: "Plogrina B.", uuid: "Compendium.world.x.Actor.PLOG", type: "NPC" },
    { name: "Sister Marjory", uuid: "Compendium.world.x.Actor.MARJ", type: "NPC" },
    { name: "Sister Agnes", uuid: "Compendium.world.x.Actor.AGN", type: "NPC" },
    { name: "Red Knight", uuid: "Compendium.shadowdark.monsters.Actor.RK", type: "NPC" },
  ];
  const r = creatureResolver(index);
  assert.equal(r("Gordock"), "Compendium.world.x.Actor.GORD");
  assert.equal(r("Gordock Breeg"), "Compendium.world.x.Actor.GORD");
  assert.equal(r("Plogrina's"), "Compendium.world.x.Actor.PLOG");
  assert.equal(r("Plogrina Bittermold"), undefined, "a longer phrase is not its first word");
  assert.equal(r("Sister"), undefined, "two actors share it");
  assert.equal(r("Red"), undefined, "the system's creatures answer only to their names");
  assert.ok(phraseKeys("Plogrina's").includes("plogrina"));
});

test("creatureResolver: a book calls an imported NPC by its first name, and by its possessive; the system's creatures and a shared first name do not", () => {
  const index = [
    { name: "Gordock Breeg", uuid: "Compendium.world.x.Actor.GORD", type: "NPC" },
    { name: "Plogrina B.", uuid: "Compendium.world.x.Actor.PLOG", type: "NPC" },
    { name: "Sister Marjory", uuid: "Compendium.world.x.Actor.MARJ", type: "NPC" },
    { name: "Sister Agnes", uuid: "Compendium.world.x.Actor.AGN", type: "NPC" },
    { name: "Red Knight", uuid: "Compendium.shadowdark.monsters.Actor.RK", type: "NPC" },
  ];
  const r = creatureResolver(index);
  assert.equal(r("Gordock"), "Compendium.world.x.Actor.GORD");
  assert.equal(r("Gordock Breeg"), "Compendium.world.x.Actor.GORD");
  assert.equal(r("Plogrina's"), "Compendium.world.x.Actor.PLOG");
  assert.equal(r("Plogrina Bittermold"), undefined, "a longer phrase is not its first word");
  assert.equal(r("Sister"), undefined, "two actors share it");
  assert.equal(r("Red"), undefined, "the system's creatures answer only to their names");
  assert.ok(phraseKeys("Plogrina's").includes("plogrina"));
});

test("a creature named as an individual, with no number, is one", () => {
  assert.deepEqual(found(`A ${b("duergar")} named Rotid crouches under the bridge.`), [{ phrase: "duergar", count: 1 }]);
  assert.deepEqual(found(`A ${b("duergar")} crouches under the bridge.`), []);
});
