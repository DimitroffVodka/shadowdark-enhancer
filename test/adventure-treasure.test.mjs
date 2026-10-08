import test from "node:test";
import assert from "node:assert/strict";
import { findTreasure, findScrolls, findPotions, potionItemData, treasurePhrase, singular, treasureItemData, scrollItemData } from "../scripts/importer/adventure/adventure-treasure.mjs";
import { linkItems } from "../scripts/importer/adventure/adventure-journal.mjs";

const one = (text) => findTreasure(`<p>${text}</p>`);

test("a priced gem becomes a Gem worth that much", () => {
  const [t] = one("Sifting reveals dozens of teeth and a blue pearl (40 gp).");
  assert.equal(t.phrase, "blue pearl");
  assert.equal(t.name, "Blue Pearl");
  assert.deepEqual(t.cost, { gp: 40, sp: 0, cp: 0 });
  assert.deepEqual(treasureItemData(t, { source: "Book" }).type, "Gem");
});

test("a count and 'each' make a stack priced per piece, named for one", () => {
  const [t] = one("20 iridescent meteorite chunks inside (30 gp each).");
  assert.equal(t.count, 20);
  assert.equal(t.name, "Iridescent Meteorite Chunk");
  assert.equal(t.cost.gp, 30);
  assert.equal(t.gem, true);
});

test("a total price over a count is split across the pieces", () => {
  const [t] = one("A stack of 15 gold ingots (1,500 gp).");
  assert.equal(t.count, 15);
  assert.equal(t.cost.gp, 100);
  assert.equal(t.gem, false);
  assert.equal(treasureItemData(t).system.treasure, true);
});

test("the thing is the noun phrase, not what is said around it", () => {
  assert.equal(one("One wears a silver rosary (20 gp).")[0].name, "Silver Rosary");
  assert.equal(one("A ruby chip in each skeleton's right eye (5 gp each).")[0].phrase, "ruby chip");
  assert.equal(one("Two gold chalices (40 gp each).")[0].count, 2);
  assert.equal(one("The sapphire pendant (300 gp).")[0].gem, false, "a pendant is not a gem");
});

test("coins, bare metals, bounties and asides that are not things are left alone", () => {
  assert.deepEqual(one("Piles of gold coins glint on the bottom (60 gp)."), []);
  assert.deepEqual(one("30 iron (10 gp each) and 20 gold (20 gp each)."), []);
  assert.deepEqual(one("The headmaster will purchase a captured angel (1,000 gp)."), []);
  assert.deepEqual(one("The idol hangs from the wall (40 gp)."), []);
  assert.deepEqual(one("Opening it takes 3 rounds (a price is not named)."), []);
});

test("text inside a link, a roll or a tag is never read", () => {
  assert.deepEqual(findTreasure("<p>@UUID[Item.x]{a pearl (40 gp)} and [[/r 1d4]] (3 gp)</p>"), []);
});

test("the same thing at the same price is one item", () => {
  assert.equal(findTreasure("<p>A blue pearl (40 gp). Later, a blue pearl (40 gp).</p>").length, 1);
});

test("singular names one of a stack", () => {
  assert.equal(singular("chunks"), "chunk");
  assert.equal(singular("rubies"), "ruby");
  assert.equal(singular("teeth"), "tooth");
  assert.equal(singular("chalices"), "chalice");
  assert.equal(singular("glass"), "glass");
});

test("treasurePhrase says nothing for a clause with no thing", () => {
  assert.equal(treasurePhrase("it takes ten rounds"), null);
  assert.equal(treasurePhrase(""), null);
});

test("a spell scroll the system has no item for becomes a scroll that points at its spell", () => {
  const spells = [{ name: "Charm Person", uuid: "Compendium.shadowdark.spells.Item.c1" }, { name: "Hold Portal", uuid: "Compendium.shadowdark.spells.Item.h1" }];
  const have = new Set(["scroll of hold portal"]);
  const found = findScrolls("<p>Inside, moldy Scroll of Charm Person. Also a Scroll of Hold Portal.</p>", spells, have);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Scroll of Charm Person");
  const data = scrollItemData(found[0]);
  assert.equal(data.type, "Basic");
  assert.match(data.system.description, /Item\.c1\]\{Charm Person\}/);
});

test("the page's links use the words as the page has them, and the rest of the text is untouched", () => {
  const html = "<p>Sifting reveals a blue pearl (40 gp) and a Blue Pearl.</p>";
  const out = linkItems(html, [{ name: "blue pearl", uuid: "Item.p1" }]);
  assert.equal(out, "<p>Sifting reveals a @UUID[Item.p1]{blue pearl} (40 gp) and a @UUID[Item.p1]{Blue Pearl}.</p>");
});

test("a potion the system has no item for becomes a potion with the key's words as its description", () => {
  const found = findPotions("<p>A flagstone lifts to reveal a Potion of Fire Protection (immunity to fire for 5 rounds) and a Potion of Healing.</p>", new Set(["potion of healing"]));
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Potion of Fire Protection");
  const data = potionItemData(found[0]);
  assert.equal(data.type, "Potion");
  assert.equal(data.system.description, "<p>Immunity to fire for 5 rounds.</p>");
});

test("a plural potion is filed under its singular name and linked by the words as printed", () => {
  const [found] = findPotions("<p>The chest holds two Potions of Fire Protection (immunity to fire for 5 rounds).</p>");
  assert.equal(found.name, "Potion of Fire Protection");
  assert.equal(found.phrase, "Potions of Fire Protection");
  assert.equal(found.text, "immunity to fire for 5 rounds");
});
